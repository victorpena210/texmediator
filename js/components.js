document.addEventListener(
    "DOMContentLoaded",
    async () => {

        /*
         * On the production website, Netlify's build
         * process has already inserted the navbar and
         * footer directly into each HTML page.
         *
         * These fallback loaders only do anything when
         * working with the unbuilt source files locally.
         */
        await Promise.all([
            loadComponentIfEmpty(
                "site-header",
                "components/navbar.html"
            ),

            loadComponentIfEmpty(
                "site-footer",
                "components/footer.html"
            )
        ]);


        initializeMobileNavigation();

        highlightCurrentPage();

        updateCopyrightYear();

    }
);



async function loadComponentIfEmpty(
    containerId,
    componentPath
) {

    const container =
        document.getElementById(
            containerId
        );


    if (!container) {

        return;

    }


    /*
     * Production build:
     *
     * If the navbar/footer has already been
     * injected into the HTML, do absolutely
     * nothing.
     */
    const alreadyHasContent =
        container.children.length > 0 ||
        container.textContent.trim().length > 0;


    if (alreadyHasContent) {

        return;

    }


    /*
     * Development fallback:
     *
     * If we're viewing the original source files,
     * the placeholders are still empty, so load
     * the components just like the old system did.
     */
    try {

        const response =
            await fetch(
                componentPath
            );


        if (!response.ok) {

            throw new Error(
                `Unable to load ${componentPath}`
            );

        }


        container.innerHTML =
            await response.text();


    } catch (error) {

        console.error(
            `Shared component fallback failed: ${componentPath}`,
            error
        );

    }

}



function highlightCurrentPage() {

    const currentPage =
        window.location.pathname
            .split("/")
            .pop() ||
        "index.html";


    document
        .querySelectorAll(
            ".main-navigation a"
        )
        .forEach((link) => {

            if (
                link.getAttribute(
                    "href"
                ) === currentPage
            ) {

                link.classList.add(
                    "active"
                );


                link.setAttribute(
                    "aria-current",
                    "page"
                );

            }

        });

}



function updateCopyrightYear() {

    const yearElement =
        document.getElementById(
            "current-year"
        );


    if (yearElement) {

        yearElement.textContent =
            new Date()
                .getFullYear();

    }

}



function initializeMobileNavigation() {

    const toggle =
        document.querySelector(
            ".navigation-toggle"
        );


    const panel =
        document.getElementById(
            "navigation-panel"
        );


    if (
        !toggle ||
        !panel
    ) {

        return;

    }



    function closeNavigation() {

        toggle.setAttribute(
            "aria-expanded",
            "false"
        );


        toggle.setAttribute(
            "aria-label",
            "Open navigation"
        );


        panel.classList.remove(
            "is-open"
        );

    }



    function openNavigation() {

        toggle.setAttribute(
            "aria-expanded",
            "true"
        );


        toggle.setAttribute(
            "aria-label",
            "Close navigation"
        );


        panel.classList.add(
            "is-open"
        );

    }



    toggle.addEventListener(
        "click",
        () => {

            const isOpen =
                toggle.getAttribute(
                    "aria-expanded"
                ) === "true";


            if (isOpen) {

                closeNavigation();

            } else {

                openNavigation();

            }

        }
    );



    panel.addEventListener(
        "click",
        (event) => {

            if (
                event.target.closest(
                    "a"
                )
            ) {

                closeNavigation();

            }

        }
    );



    document.addEventListener(
        "click",
        (event) => {

            const clickedOutside =
                !toggle.contains(
                    event.target
                ) &&
                !panel.contains(
                    event.target
                );


            if (clickedOutside) {

                closeNavigation();

            }

        }
    );



    document.addEventListener(
        "keydown",
        (event) => {

            if (
                event.key === "Escape"
            ) {

                closeNavigation();

                toggle.focus();

            }

        }
    );



    const desktopBreakpoint =
        window.matchMedia(
            "(min-width: 961px)"
        );


    desktopBreakpoint.addEventListener(
        "change",
        (event) => {

            if (event.matches) {

                closeNavigation();

            }

        }
    );

}