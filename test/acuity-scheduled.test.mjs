import assert from "node:assert/strict";

import {
    createHmac
} from "node:crypto";

import test from "node:test";

import {
    createAcuityScheduledHandler,
    findAppointmentFieldValue,
    normalizeBillingEmail,
    parseAcuityWebhookBody,
    verifyAcuitySignature
} from "../netlify/functions/acuity-scheduled.mjs";


const ACUITY_API_KEY =
    "test-acuity-api-key";


function sign(
    body
) {

    return createHmac(
        "sha256",
        ACUITY_API_KEY
    )
        .update(body, "utf8")
        .digest("base64");

}


function webhookEvent(
    body
) {

    return {
        httpMethod: "POST",
        headers: {
            "x-acuity-signature":
                sign(body)
        },
        body,
        isBase64Encoded: false
    };

}


function appointmentResponse() {

    return {
        ok: true,
        status: 200,
        async json() {
            return {
                id: 12345,
                appointmentTypeID: 97139812,
                forms: [
                    {
                        values: [
                            {
                                fieldID: 77,
                                name:
                                    "Party B billing email address",
                                value:
                                    "PartyB@example.com"
                            }
                        ]
                    }
                ]
            };
        }
    };

}


function environment() {

    return {
        ACUITY_API_KEY,
        ACUITY_USER_ID: "40116063",
        ACUITY_PARTY_B_EMAIL_FIELD_ID:
            "77",
        STRIPE_INVOICE_DAYS_UNTIL_DUE:
            "1",
        BILLING_CONTACT_EMAIL:
            "hugh@texmediator.com"
    };

}


test(
    "verifies a genuine Acuity webhook signature",
    () => {

        const body =
            "action=scheduled&id=12345";

        assert.equal(
            verifyAcuitySignature({
                body,
                signature: sign(body),
                secret: ACUITY_API_KEY
            }),
            true
        );

        assert.equal(
            verifyAcuitySignature({
                body,
                signature: sign(
                    `${body}&forged=true`
                ),
                secret: ACUITY_API_KEY
            }),
            false
        );

    }
);


test(
    "parses Acuity form-encoded webhook data",
    () => {

        assert.deepEqual(
            parseAcuityWebhookBody(
                "action=scheduled&id=12345&calendarID=8&appointmentTypeID=97139812"
            ),
            {
                action: "scheduled",
                appointmentId: "12345",
                appointmentTypeId:
                    "97139812",
                calendarId: "8"
            }
        );

    }
);


test(
    "finds Party B email by stable field ID or exact label",
    () => {

        const appointment = {
            forms: [
                {
                    values: [
                        {
                            fieldID: 77,
                            name:
                                "Party B billing email address",
                            value:
                                "billing@example.com"
                        }
                    ]
                }
            ]
        };

        assert.equal(
            findAppointmentFieldValue(
                appointment,
                {
                    fieldId: "77",
                    fieldName: "unused"
                }
            ),
            "billing@example.com"
        );

        assert.equal(
            findAppointmentFieldValue(
                appointment,
                {
                    fieldName:
                        "party b billing email address"
                }
            ),
            "billing@example.com"
        );

        assert.equal(
            normalizeBillingEmail(
                " Billing@Example.com "
            ),
            "billing@example.com"
        );

    }
);


test(
    "creates and sends one correctly priced Party B invoice",
    async () => {

        const calls = [];

        const stripeClient = {
            invoices: {
                async search(parameters) {
                    calls.push([
                        "invoices.search",
                        parameters
                    ]);
                    return {
                        data: []
                    };
                },
                async create(
                    parameters,
                    options
                ) {
                    calls.push([
                        "invoices.create",
                        parameters,
                        options
                    ]);
                    return {
                        id: "in_test_123",
                        status: "draft",
                        customer: "cus_test_123"
                    };
                },
                async sendInvoice(
                    invoiceId,
                    parameters,
                    options
                ) {
                    calls.push([
                        "invoices.sendInvoice",
                        invoiceId,
                        parameters,
                        options
                    ]);
                    return {
                        id: invoiceId,
                        status: "open"
                    };
                }
            },
            customers: {
                async list(parameters) {
                    calls.push([
                        "customers.list",
                        parameters
                    ]);
                    return {
                        data: []
                    };
                },
                async create(
                    parameters,
                    options
                ) {
                    calls.push([
                        "customers.create",
                        parameters,
                        options
                    ]);
                    return {
                        id: "cus_test_123"
                    };
                }
            },
            invoiceItems: {
                async list(parameters) {
                    calls.push([
                        "invoiceItems.list",
                        parameters
                    ]);
                    return {
                        data: []
                    };
                },
                async create(
                    parameters,
                    options
                ) {
                    calls.push([
                        "invoiceItems.create",
                        parameters,
                        options
                    ]);
                    return {
                        id: "ii_test_123",
                        amount: parameters.amount,
                        metadata:
                            parameters.metadata
                    };
                }
            }
        };

        const handler =
            createAcuityScheduledHandler({
                stripeClient,
                fetchImpl: async () =>
                    appointmentResponse(),
                environment: environment(),
                logger: {
                    error() {}
                }
            });

        const body =
            "action=scheduled&id=12345&calendarID=8&appointmentTypeID=97139812";

        const response =
            await handler(
                webhookEvent(body)
            );

        assert.equal(
            response.statusCode,
            200
        );

        assert.equal(
            JSON.parse(response.body).status,
            "invoice_sent"
        );

        const invoiceCreate =
            calls.find(
                ([name]) =>
                    name === "invoices.create"
            );

        assert.equal(
            invoiceCreate[1]
                .collection_method,
            "send_invoice"
        );

        assert.equal(
            invoiceCreate[1]
                .pending_invoice_items_behavior,
            "exclude"
        );

        assert.equal(
            "payment_method_types" in
                invoiceCreate[1],
            false
        );

        const itemCreate =
            calls.find(
                ([name]) =>
                    name ===
                    "invoiceItems.create"
            );

        assert.equal(
            itemCreate[1].amount,
            45000
        );

        assert.equal(
            itemCreate[1]
                .metadata
                .acuity_appointment_id,
            "12345"
        );

        assert.match(
            itemCreate[2].idempotencyKey,
            /12345/
        );

    }
);


test(
    "does not create or send another invoice for a processed appointment",
    async () => {

        let createCallCount = 0;
        let sendCallCount = 0;

        const stripeClient = {
            invoices: {
                async search() {
                    return {
                        data: [
                            {
                                id: "in_existing",
                                status: "open",
                                customer:
                                    "cus_existing"
                            }
                        ]
                    };
                },
                async create() {
                    createCallCount += 1;
                },
                async sendInvoice() {
                    sendCallCount += 1;
                }
            },
            customers: {},
            invoiceItems: {}
        };

        const handler =
            createAcuityScheduledHandler({
                stripeClient,
                fetchImpl: async () =>
                    appointmentResponse(),
                environment: environment(),
                logger: {
                    error() {}
                }
            });

        const body =
            "action=scheduled&id=12345&calendarID=8&appointmentTypeID=97139812";

        const response =
            await handler(
                webhookEvent(body)
            );

        assert.equal(
            response.statusCode,
            200
        );

        assert.equal(
            JSON.parse(response.body).status,
            "already_processed"
        );

        assert.equal(
            createCallCount,
            0
        );

        assert.equal(
            sendCallCount,
            0
        );

    }
);
