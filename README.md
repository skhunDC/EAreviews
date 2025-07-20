# Employee Review Portal

This project contains a simple Google Apps Script web application used to collect annual employee reviews.

## Features
- Google Apps Script backend (`Code.gs`) manages user authentication, review data, and language preference storage.
- HTML/JavaScript frontend (`index.html`) displays the review form and includes a small EN/ES switch to change languages. All visible text uses `data-i18n-key` attributes so the entire interface switches language.
- Review questions can be loaded from a spreadsheet or fall back to defaults in the page.
- Managers and HR can adjust compensation and record final expectations.

The project is intentionally lightweight and open. Feel free to modify or extend it as needed.
