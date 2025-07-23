# Employee Review Portal

This project contains a simple Google Apps Script web application used to collect annual employee reviews.

## Features
- Google Apps Script backend (`Code.gs`) manages user authentication, review data, and language preference storage. Review submissions are stored as JSON files in a private Drive folder instead of a spreadsheet, and user passwords are stored as salted SHA-256 hashes.
- HTML/JavaScript frontend (`index.html`) displays the review form and includes a small EN/ES switch to change languages. All visible text uses `data-i18n-key` attributes so the entire interface switches language.
- Managers and HR can adjust compensation and record final expectations.
- Whenever the Reviews section is opened, the application reloads the latest
  saved review from the server so users always see their most recent answers.
- The dev button is always visible, but opening the dev panel requires
  authentication through the Chrome browser OAuth session. Only the accounts
  `skhun@dublincleaners.com` and `ss.sku@protonmail.com` are allowed to access
  it. Authorized developers can create new users from the panel with passwords of
  any complexity. They can also reset an existing user's password from the dev
  panel. All passwords are hashed before being stored. Developer accounts
  automatically sign in via the Chrome browser's OAuth session and do not
  require a password. When the page loads and the OAuth email matches one of the
  developer accounts, the dev panel opens automatically with no password prompt.

The project is intentionally lightweight and open. Feel free to modify or extend it as needed.
