# Repository Information

This repository contains a minimal employee review portal built with Google Apps Script.

- `index.html` provides the client interface and handles language switching with `data-i18n` attributes.
- `Code.gs` includes server-side functions for authentication, data storage, and configuration.

There are no automated tests or build steps. When updating the project, simply ensure the HTML and JavaScript remain valid.

## Mobile + Desktop Compatibility
The interface is fully responsive. Tailwind CSS utilities together with Flexbox, Grid and media queries provide a mobile-first layout that adapts to desktops. Bilingual functionality is preserved at all screen sizes.
