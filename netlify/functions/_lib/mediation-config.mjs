export const MEDIATION_TYPES = Object.freeze({
    "97139812": Object.freeze({
        name: "Two-Hour Mediation",
        amountCents: 45000
    }),
    "96980378": Object.freeze({
        name: "Half-Day Mediation — Personal Lines",
        amountCents: 85000
    }),
    "96980693": Object.freeze({
        name: "Half-Day Mediation — Commercial Lines",
        amountCents: 100000
    }),
    "96982073": Object.freeze({
        name: "Full-Day Mediation — Personal Lines",
        amountCents: 170000
    }),
    "96982161": Object.freeze({
        name: "Full-Day Mediation — Commercial Lines",
        amountCents: 200000
    })
});


export function getMediationType(
    appointmentTypeId
) {

    return MEDIATION_TYPES[
        String(appointmentTypeId)
    ] ?? null;

}
