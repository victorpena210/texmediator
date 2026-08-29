import {
    createHash,
    createHmac,
    timingSafeEqual
} from "node:crypto";

import Stripe from "stripe";

import {
    getMediationType
} from "./_lib/mediation-config.mjs";


const STRIPE_API_VERSION =
    "2026-07-29.dahlia";

const DEFAULT_PARTY_B_FIELD_NAME =
    "Party B billing email address";

const DEFAULT_BILLING_EMAIL =
    "hugh@texmediator.com";

const EMAIL_PATTERN =
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/;


function jsonResponse(
    statusCode,
    payload,
    extraHeaders = {}
) {

    return {
        statusCode,
        headers: {
            "content-type":
                "application/json; charset=utf-8",
            "cache-control": "no-store",
            ...extraHeaders
        },
        body: JSON.stringify(payload)
    };

}


function getRawBody(
    event
) {

    const body =
        event.body ?? "";

    if (!event.isBase64Encoded) {
        return body;
    }

    return Buffer
        .from(body, "base64")
        .toString("utf8");

}


function getHeader(
    headers,
    targetName
) {

    const normalizedTarget =
        targetName.toLowerCase();

    for (const [name, value] of Object.entries(
        headers ?? {}
    )) {

        if (
            name.toLowerCase() ===
            normalizedTarget
        ) {
            return value;
        }

    }

    return undefined;

}


export function verifyAcuitySignature({
    body,
    signature,
    secret
}) {

    if (
        !body ||
        !signature ||
        !secret
    ) {
        return false;
    }

    const expected =
        createHmac("sha256", secret)
            .update(body, "utf8")
            .digest("base64");

    const expectedBuffer =
        Buffer.from(expected, "utf8");

    const signatureBuffer =
        Buffer.from(signature, "utf8");

    if (
        expectedBuffer.length !==
        signatureBuffer.length
    ) {
        return false;
    }

    return timingSafeEqual(
        expectedBuffer,
        signatureBuffer
    );

}


export function parseAcuityWebhookBody(
    body
) {

    const parameters =
        new URLSearchParams(body);

    return {
        action:
            parameters.get("action") ?? "",
        appointmentId:
            parameters.get("id") ?? "",
        appointmentTypeId:
            parameters.get("appointmentTypeID") ?? "",
        calendarId:
            parameters.get("calendarID") ?? ""
    };

}


function normalizeFieldName(
    value
) {

    return String(value ?? "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");

}


function collectAppointmentFields(
    appointment
) {

    const collected = [];

    if (Array.isArray(appointment.fields)) {
        collected.push(...appointment.fields);
    }

    for (const form of appointment.forms ?? []) {

        if (Array.isArray(form.values)) {
            collected.push(...form.values);
        }

        if (Array.isArray(form.fields)) {
            collected.push(...form.fields);
        }

    }

    return collected;

}


export function findAppointmentFieldValue(
    appointment,
    {
        fieldId,
        fieldName
    }
) {

    const fields =
        collectAppointmentFields(
            appointment
        );

    const normalizedId =
        String(fieldId ?? "").trim();

    if (normalizedId) {

        const idMatch =
            fields.find((field) =>
                String(
                    field.fieldID ??
                    field.fieldId ??
                    field.id ??
                    ""
                ) === normalizedId
            );

        if (idMatch) {
            return String(
                idMatch.value ?? ""
            ).trim();
        }

    }

    const normalizedName =
        normalizeFieldName(
            fieldName
        );

    const nameMatch =
        fields.find((field) =>
            normalizeFieldName(
                field.name ??
                field.label ??
                field.fieldName
            ) === normalizedName
        );

    return String(
        nameMatch?.value ?? ""
    ).trim();

}


export function normalizeBillingEmail(
    value
) {

    const email =
        String(value ?? "")
            .trim()
            .toLowerCase();

    return EMAIL_PATTERN.test(email)
        ? email
        : null;

}


function requireEnvironmentValue(
    environment,
    name
) {

    const value =
        environment[name]?.trim();

    if (!value) {
        throw new Error(
            `Missing required environment variable: ${name}`
        );
    }

    return value;

}


function getInvoiceDueDays(
    environment
) {

    const dueDays =
        Number.parseInt(
            environment
                .STRIPE_INVOICE_DAYS_UNTIL_DUE ??
            "1",
            10
        );

    if (
        !Number.isInteger(dueDays) ||
        dueDays < 1 ||
        dueDays > 90
    ) {
        throw new Error(
            "STRIPE_INVOICE_DAYS_UNTIL_DUE must be an integer from 1 to 90."
        );
    }

    return dueDays;

}


function getBillingContactEmail(
    environment
) {

    const email =
        normalizeBillingEmail(
            environment
                .BILLING_CONTACT_EMAIL ??
            DEFAULT_BILLING_EMAIL
        );

    if (!email) {
        throw new Error(
            "BILLING_CONTACT_EMAIL must be a valid email address."
        );
    }

    return email;

}


async function fetchAcuityAppointment({
    appointmentId,
    acuityUserId,
    acuityApiKey,
    fetchImpl
}) {

    const authorization =
        Buffer
            .from(
                `${acuityUserId}:${acuityApiKey}`,
                "utf8"
            )
            .toString("base64");

    const response =
        await fetchImpl(
            `https://acuityscheduling.com/api/v1/appointments/${appointmentId}`,
            {
                method: "GET",
                headers: {
                    accept: "application/json",
                    authorization:
                        `Basic ${authorization}`
                }
            }
        );

    if (!response.ok) {
        throw new Error(
            `Acuity appointment lookup failed with HTTP ${response.status}.`
        );
    }

    return response.json();

}


function invoiceMetadata(
    appointmentId,
    appointmentTypeId
) {

    return {
        acuity_appointment_id:
            String(appointmentId),
        acuity_appointment_type_id:
            String(appointmentTypeId),
        integration:
            "texmediator_acuity",
        party: "B"
    };

}


async function findExistingInvoice(
    stripeClient,
    appointmentId
) {

    const results =
        await stripeClient.invoices.search({
            query:
                `metadata["acuity_appointment_id"]:"${appointmentId}" AND metadata["party"]:"B"`,
            limit: 10
        });

    if (results.data.length > 1) {
        throw new Error(
            "Multiple Party B invoices already exist for this Acuity appointment."
        );
    }

    return results.data[0] ?? null;

}


function customerIdFromInvoice(
    invoice
) {

    if (
        typeof invoice.customer ===
        "string"
    ) {
        return invoice.customer;
    }

    return invoice.customer?.id ?? null;

}


async function getOrCreateCustomer({
    stripeClient,
    email
}) {

    const existingCustomers =
        await stripeClient.customers.list({
            email,
            limit: 1
        });

    if (existingCustomers.data[0]) {
        return existingCustomers.data[0];
    }

    const emailFingerprint =
        createHash("sha256")
            .update(email, "utf8")
            .digest("hex")
            .slice(0, 32);

    return stripeClient.customers.create(
        {
            email,
            description:
                "Party B mediation billing contact",
            metadata: {
                acuity_role: "party_b",
                integration:
                    "texmediator_acuity"
            }
        },
        {
            idempotencyKey:
                `texmediator:party-b-customer:${emailFingerprint}:v1`
        }
    );

}


async function ensureInvoiceItem({
    stripeClient,
    invoice,
    customerId,
    mediation,
    metadata,
    appointmentId
}) {

    const existingItems =
        await stripeClient.invoiceItems.list({
            invoice: invoice.id,
            limit: 100
        });

    const matchingItems =
        existingItems.data.filter((item) =>
            item.metadata
                ?.acuity_appointment_id ===
                String(appointmentId) &&
            item.metadata?.party === "B"
        );

    if (matchingItems.length > 1) {
        throw new Error(
            "The draft invoice contains duplicate Party B line items."
        );
    }

    if (matchingItems[0]) {

        if (
            matchingItems[0].amount !==
            mediation.amountCents
        ) {
            throw new Error(
                "The existing Party B line item does not match the configured mediation fee."
            );
        }

        return matchingItems[0];

    }

    if (existingItems.data.length > 0) {
        throw new Error(
            "The draft invoice contains an unexpected line item and was not sent."
        );
    }

    return stripeClient.invoiceItems.create(
        {
            customer: customerId,
            invoice: invoice.id,
            amount: mediation.amountCents,
            currency: "usd",
            description:
                `${mediation.name} — Party B share`,
            metadata
        },
        {
            idempotencyKey:
                `texmediator:acuity:${appointmentId}:party-b-item:v1`
        }
    );

}


async function createAndSendPartyBInvoice({
    stripeClient,
    appointmentId,
    appointmentTypeId,
    partyBEmail,
    mediation,
    dueDays,
    billingContactEmail
}) {

    const metadata =
        invoiceMetadata(
            appointmentId,
            appointmentTypeId
        );

    let invoice =
        await findExistingInvoice(
            stripeClient,
            appointmentId
        );

    if (
        invoice &&
        invoice.status !== "draft"
    ) {
        return {
            invoice,
            duplicate: true
        };
    }

    let customerId =
        invoice
            ? customerIdFromInvoice(invoice)
            : null;

    if (!customerId) {

        const customer =
            await getOrCreateCustomer({
                stripeClient,
                email: partyBEmail
            });

        customerId = customer.id;

    }

    if (!invoice) {

        invoice =
            await stripeClient.invoices.create(
                {
                    customer: customerId,
                    collection_method:
                        "send_invoice",
                    days_until_due: dueDays,
                    auto_advance: false,
                    pending_invoice_items_behavior:
                        "exclude",
                    description:
                        `${mediation.name} — Party B share`,
                    footer:
                        `Billing questions: ${billingContactEmail}`,
                    custom_fields: [
                        {
                            name: "Appointment",
                            value:
                                `A-${appointmentId}`
                        }
                    ],
                    metadata
                },
                {
                    idempotencyKey:
                        `texmediator:acuity:${appointmentId}:party-b-invoice:v1`
                }
            );

    }

    await ensureInvoiceItem({
        stripeClient,
        invoice,
        customerId,
        mediation,
        metadata,
        appointmentId
    });

    const sentInvoice =
        await stripeClient.invoices.sendInvoice(
            invoice.id,
            {},
            {
                idempotencyKey:
                    `texmediator:acuity:${appointmentId}:party-b-send:v1`
            }
        );

    return {
        invoice: sentInvoice,
        duplicate: false
    };

}


export function createAcuityScheduledHandler({
    stripeClient,
    fetchImpl = globalThis.fetch,
    environment = process.env,
    logger = console
}) {

    return async function acuityScheduledHandler(
        event
    ) {

        if (
            (event.httpMethod ?? "POST") !==
            "POST"
        ) {
            return jsonResponse(
                405,
                {
                    error: "method_not_allowed"
                },
                {
                    allow: "POST"
                }
            );
        }

        try {

            const acuityApiKey =
                requireEnvironmentValue(
                    environment,
                    "ACUITY_API_KEY"
                );

            const rawBody =
                getRawBody(event);

            const signature =
                getHeader(
                    event.headers,
                    "x-acuity-signature"
                );

            if (
                !verifyAcuitySignature({
                    body: rawBody,
                    signature,
                    secret: acuityApiKey
                })
            ) {
                return jsonResponse(
                    401,
                    {
                        error:
                            "invalid_webhook_signature"
                    }
                );
            }

            const webhook =
                parseAcuityWebhookBody(
                    rawBody
                );

            if (
                webhook.action !==
                "scheduled"
            ) {
                return jsonResponse(
                    200,
                    {
                        status: "ignored",
                        reason:
                            "not_a_scheduled_event"
                    }
                );
            }

            if (
                !/^\d+$/.test(
                    webhook.appointmentId
                )
            ) {
                return jsonResponse(
                    400,
                    {
                        error:
                            "invalid_appointment_id"
                    }
                );
            }

            const acuityUserId =
                requireEnvironmentValue(
                    environment,
                    "ACUITY_USER_ID"
                );

            const appointment =
                await fetchAcuityAppointment({
                    appointmentId:
                        webhook.appointmentId,
                    acuityUserId,
                    acuityApiKey,
                    fetchImpl
                });

            const appointmentTypeId =
                String(
                    appointment
                        .appointmentTypeID ??
                    webhook.appointmentTypeId
                );

            const mediation =
                getMediationType(
                    appointmentTypeId
                );

            if (!mediation) {
                return jsonResponse(
                    200,
                    {
                        status: "ignored",
                        reason:
                            "unsupported_appointment_type",
                        appointment_id:
                            webhook.appointmentId
                    }
                );
            }

            const partyBEmail =
                normalizeBillingEmail(
                    findAppointmentFieldValue(
                        appointment,
                        {
                            fieldId:
                                environment
                                    .ACUITY_PARTY_B_EMAIL_FIELD_ID,
                            fieldName:
                                environment
                                    .ACUITY_PARTY_B_EMAIL_FIELD_NAME ??
                                DEFAULT_PARTY_B_FIELD_NAME
                        }
                    )
                );

            if (!partyBEmail) {
                return jsonResponse(
                    200,
                    {
                        status: "skipped",
                        reason:
                            "missing_or_invalid_party_b_email",
                        appointment_id:
                            webhook.appointmentId
                    }
                );
            }

            const result =
                await createAndSendPartyBInvoice({
                    stripeClient,
                    appointmentId:
                        webhook.appointmentId,
                    appointmentTypeId,
                    partyBEmail,
                    mediation,
                    dueDays:
                        getInvoiceDueDays(
                            environment
                        ),
                    billingContactEmail:
                        getBillingContactEmail(
                            environment
                        )
                });

            return jsonResponse(
                200,
                {
                    status:
                        result.duplicate
                            ? "already_processed"
                            : "invoice_sent",
                    appointment_id:
                        webhook.appointmentId,
                    invoice_id:
                        result.invoice.id,
                    invoice_status:
                        result.invoice.status
                }
            );

        } catch (error) {

            logger.error(
                "Party B invoice automation failed.",
                {
                    error_name:
                        error?.name ??
                        "Error",
                    error_code:
                        error?.code ??
                        "unknown"
                }
            );

            return jsonResponse(
                500,
                {
                    error:
                        "party_b_invoice_automation_failed"
                }
            );

        }

    };

}


export async function handler(
    event
) {

    try {

        const stripeKey =
            requireEnvironmentValue(
                process.env,
                "STRIPE_RESTRICTED_KEY"
            );

        if (!stripeKey.startsWith("rk_")) {
            throw new Error(
                "STRIPE_RESTRICTED_KEY must be a restricted Stripe API key."
            );
        }

        const stripeClient =
            new Stripe(
                stripeKey,
                {
                    apiVersion:
                        STRIPE_API_VERSION,
                    maxNetworkRetries: 2,
                    timeout: 20000
                }
            );

        return createAcuityScheduledHandler({
            stripeClient
        })(event);

    } catch (error) {

        console.error(
            "Party B invoice automation is not configured.",
            {
                error_name:
                    error?.name ??
                    "Error"
            }
        );

        return jsonResponse(
            500,
            {
                error:
                    "party_b_invoice_automation_not_configured"
            }
        );

    }

}
