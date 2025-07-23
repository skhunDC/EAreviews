# Employee Review Portal

This project contains a simple Google Apps Script web application used to collect annual employee reviews.

## Features
- Google Apps Script backend (`Code.gs`) manages user authentication, review data, and language preference storage. Review submissions are stored as JSON files in a private Drive folder instead of a spreadsheet, and user passwords are stored as salted SHA-256 hashes.
- HTML/JavaScript frontend (`index.html`) displays the review form and includes a small EN/ES switch to change languages. All visible text uses `data-i18n-key` attributes so the entire interface switches language.
- Managers and HR can adjust compensation and record final expectations.
- Whenever the Reviews section is opened, the application reloads the latest
  saved review from the server so users always see their most recent answers.
- The dev button is always visible. Developers simply log in with a user account
  whose role is `DEV` to open the dev panel. These accounts can create new users
  from the panel with passwords of any complexity and can reset existing user
  passwords. All passwords are hashed before being stored. The developer panel
  now includes a **Clear Reviews** button which permanently deletes all stored
  review files from Drive via the new `deleteAllReviews` function in `Code.gs`.

The project is intentionally lightweight and open. Feel free to modify or extend it as needed.
