import {
    cp,
    mkdir,
    readFile,
    readdir,
    rm,
    writeFile
} from "node:fs/promises";

import path from "node:path";

import {
    fileURLToPath
} from "node:url";


const ROOT = path.resolve(
    path.dirname(
        fileURLToPath(import.meta.url)
    ),
    ".."
);

const DIST =
    path.join(
        ROOT,
        "dist"
    );

const COMPONENTS_DIR =
    path.join(
        ROOT,
        "components"
    );


const PUBLIC_DIRECTORIES = new Set([
    "css",
    "images",
    "js"
]);


const PUBLIC_EXTENSION_ALLOWLIST = new Set([
    ".html",
    ".ico",
    ".jpeg",
    ".jpg",
    ".png",
    ".svg",
    ".txt",
    ".webmanifest",
    ".webp",
    ".xml"
]);


const PUBLIC_EXTENSIONLESS_FILES = new Set([
    "_redirects"
]);


const HEADER_PLACEHOLDER =
    /<div\s+id=["']site-header["']\s*><\/div>/i;


const FOOTER_PLACEHOLDER =
    /<footer\s+id=["']site-footer["']\s*><\/footer>/i;



function indentBlock(
    text,
    spaces = 4
) {

    const padding =
        " ".repeat(spaces);

    return text
        .split("\n")
        .map((line) =>
            line.length
                ? `${padding}${line}`
                : ""
        )
        .join("\n");

}



async function collectHtmlFiles(
    directory
) {

    const entries =
        await readdir(
            directory,
            {
                withFileTypes: true
            }
        );

    const htmlFiles = [];


    for (const entry of entries) {

        const fullPath =
            path.join(
                directory,
                entry.name
            );


        if (entry.isDirectory()) {

            htmlFiles.push(
                ...await collectHtmlFiles(
                    fullPath
                )
            );

            continue;

        }


        if (
            entry.isFile() &&
            entry.name.endsWith(".html")
        ) {

            htmlFiles.push(
                fullPath
            );

        }

    }


    return htmlFiles;

}



async function copyPublicSite() {

    const entries =
        await readdir(
            ROOT,
            {
                withFileTypes: true
            }
        );


    for (const entry of entries) {

        const isPublicDirectory =
            entry.isDirectory() &&
            PUBLIC_DIRECTORIES.has(
                entry.name
            );


        const isPublicFile =
            entry.isFile() &&
            (
                PUBLIC_EXTENSIONLESS_FILES.has(
                    entry.name
                ) ||
                PUBLIC_EXTENSION_ALLOWLIST.has(
                    path
                        .extname(entry.name)
                        .toLowerCase()
                )
            );


        if (
            !isPublicDirectory &&
            !isPublicFile
        ) {

            continue;

        }


        const sourcePath =
            path.join(
                ROOT,
                entry.name
            );


        const destinationPath =
            path.join(
                DIST,
                entry.name
            );


        await cp(
            sourcePath,
            destinationPath,
            {
                recursive: true,
                force: true
            }
        );

    }

}



async function injectSharedComponents() {

    const navbar = (
        await readFile(
            path.join(
                COMPONENTS_DIR,
                "navbar.html"
            ),
            "utf8"
        )
    ).trim();


    const footer = (
        await readFile(
            path.join(
                COMPONENTS_DIR,
                "footer.html"
            ),
            "utf8"
        )
    ).trim();


    const htmlFiles =
        await collectHtmlFiles(
            DIST
        );


    let builtPageCount = 0;


    for (const filePath of htmlFiles) {

        let html =
            await readFile(
                filePath,
                "utf8"
            );


        const hasHeaderPlaceholder =
            HEADER_PLACEHOLDER.test(
                html
            );


        const hasFooterPlaceholder =
            FOOTER_PLACEHOLDER.test(
                html
            );


        /*
         * Ignore HTML files that are not part
         * of the shared-layout architecture.
         */
        if (
            !hasHeaderPlaceholder &&
            !hasFooterPlaceholder
        ) {

            continue;

        }


        /*
         * If a page has one placeholder but not
         * the other, something is inconsistent.
         * Fail the build instead of silently
         * publishing a broken page.
         */
        if (
            !hasHeaderPlaceholder ||
            !hasFooterPlaceholder
        ) {

            const relativePath =
                path.relative(
                    ROOT,
                    filePath
                );


            throw new Error(
                `${relativePath} must contain both ` +
                "the site-header and site-footer placeholders."
            );

        }



html = html.replace(
    HEADER_PLACEHOLDER,
    [
        '<div id="site-header">',
        "    <!-- Shared navbar injected at build time for SEO/AEO. -->",
        indentBlock(
            navbar,
            4
        ),
        "</div>"
    ].join("\n")
);


        /*
         * Keep #site-footer as the outer footer
         * element because the existing JavaScript
         * and CSS architecture already expects it.
         */
        html = html.replace(
            FOOTER_PLACEHOLDER,
            [
                '<footer id="site-footer">',
                "    <!-- Shared footer injected at build time for SEO/AEO. -->",
                indentBlock(
                    footer,
                    4
                ),
                "</footer>"
            ].join("\n")
        );


        await writeFile(
            filePath,
            html,
            "utf8"
        );


        builtPageCount += 1;

    }


    if (builtPageCount === 0) {

        throw new Error(
            "No pages were built. Expected pages with site-header/site-footer placeholders."
        );

    }


    return builtPageCount;

}



async function validateBuiltSite() {

    const htmlFiles =
        await collectHtmlFiles(
            DIST
        );


    const problems = [];


    for (const filePath of htmlFiles) {

        const html =
            await readFile(
                filePath,
                "utf8"
            );


        const relativePath =
            path.relative(
                DIST,
                filePath
            );


        if (
            HEADER_PLACEHOLDER.test(
                html
            )
        ) {

            problems.push(
                `${relativePath}: empty site-header remains`
            );

        }


        if (
            FOOTER_PLACEHOLDER.test(
                html
            )
        ) {

            problems.push(
                `${relativePath}: empty site-footer remains`
            );

        }


        if (
            !html.includes(
                'aria-label="Main navigation"'
            )
        ) {

            problems.push(
                `${relativePath}: main navigation was not injected`
            );

        }


        if (
            !html.includes(
                "TexMediator P.L.L.C. All rights reserved."
            )
        ) {

            problems.push(
                `${relativePath}: footer was not injected`
            );

        }

    }


    if (problems.length > 0) {

        throw new Error(
            `Build validation failed:\n- ${problems.join(
                "\n- "
            )}`
        );

    }

}



async function build() {

    /*
     * Start every build with a completely fresh
     * dist directory.
     */
    await rm(
        DIST,
        {
            recursive: true,
            force: true
        }
    );


    await mkdir(
        DIST,
        {
            recursive: true
        }
    );


    /*
     * Copy only files that belong on the
     * public website.
     */
    await copyPublicSite();


    /*
     * Replace the navbar/footer placeholders
     * with actual HTML.
     */
    const builtPageCount =
        await injectSharedComponents();


    /*
     * Make sure a bad build can never silently
     * reach production.
     */
    await validateBuiltSite();


    console.log(
        `Built ${builtPageCount} HTML pages into dist/.`
    );


    console.log(
        "Navbar/footer are now present in the deployed HTML response."
    );

}



build().catch((error) => {

    console.error(error);

    process.exit(1);

});