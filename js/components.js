document.addEventListener("DOMContentLoaded", async () => {
    const headerContainer = document.getElementById("site-header");

    if (!headerContainer) {
        return;
    }

    try {
        const response = await fetch("components/navbar.html");

        if (!response.ok) {
            throw new Error("Unable to load the navigation.");
        }

        headerContainer.innerHTML = await response.text();

        highlightCurrentPage();
    } catch (error) {
        console.error(error);
    }
});

function highlightCurrentPage() {
    const currentPage =
        window.location.pathname.split("/").pop() || "index.html";

    document.querySelectorAll(".main-navigation a").forEach((link) => {
        if (link.getAttribute("href") === currentPage) {
            link.classList.add("active");
            link.setAttribute("aria-current", "page");
        }
    });
}