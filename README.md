# Employee Review Portal

This project contains a simple Google Apps Script web application used to collect annual employee reviews.

## Features
- Google Apps Script backend (`Code.gs`) manages user authentication, review data, and language preference storage. User passwords are stored as salted SHA-256 hashes.
- HTML/JavaScript frontend (`index.html`) displays the review form and includes a small EN/ES switch to change languages. All visible text uses `data-i18n-key` attributes so the entire interface switches language.
- Review questions can be loaded from a spreadsheet or fall back to defaults in the page.
- Managers and HR can adjust compensation and record final expectations.
- Review answers are now automatically saved as you type, so progress persists across logins.
- Submission status is displayed next to the review button for quick feedback.
- The dev button is always visible, but opening the dev panel requires
  authentication through the Chrome browser OAuth session. Only the accounts
  `skhun@dublincleaners.com` and `ss.sku@protonmail.com` are allowed to access
  it. Authorized developers can create new users from the panel with securely
  hashed passwords.

The project is intentionally lightweight and open. Feel free to modify or extend it as needed.
