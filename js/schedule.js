document.addEventListener("DOMContentLoaded", () => {
    const bookButtons = document.querySelectorAll(
        ".mediation-book-button"
    );

    const schedulerCard =
        document.getElementById("calendar");

    const schedulerIframe =
        document.getElementById("acuity-scheduler");

    if (
        !bookButtons.length ||
        !schedulerCard ||
        !schedulerIframe
    ) {
        return;
    }

    let acuityScriptLoaded = false;

    function loadAcuityEmbedScript() {
        if (acuityScriptLoaded) {
            return;
        }

        const script =
            document.createElement("script");

        script.src =
            "https://embed.acuityscheduling.com/js/embed.js";

        script.type =
            "text/javascript";

        script.onload = () => {
            acuityScriptLoaded = true;
        };

        document.body.appendChild(script);
    }

    bookButtons.forEach((button) => {
        button.addEventListener("click", () => {
            const acuityUrl =
                button.dataset.acuityUrl;

            if (!acuityUrl) {
                return;
            }

            const schedulerUrl =
                new URL(acuityUrl);

            schedulerUrl.searchParams.set(
                "ref",
                "embedded_csp"
            );

            /*
             * Load the real Acuity scheduler first.
             */
            schedulerIframe.src =
                schedulerUrl.toString();

            /*
             * Reveal the scheduler.
             */
            schedulerCard.hidden = false;

            /*
             * Now initialize Acuity's embed script
             * so it can resize the iframe properly.
             */
            loadAcuityEmbedScript();

            /*
             * Move the visitor to the calendar.
             */
            window.setTimeout(() => {
                const schedulerTop =
                    schedulerCard
                        .getBoundingClientRect()
                        .top +
                    window.scrollY;

                const calendarOffset =
                    window.matchMedia(
                        "(max-width: 700px)"
                    ).matches
                        ? 300
                        : 400;

                window.scrollTo({
                    top:
                        schedulerTop +
                        calendarOffset,
                    behavior: "smooth"
                });
            }, 700);
        });
    });
});