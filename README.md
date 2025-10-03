# Employee Review Portal

This project contains a simple Google Apps Script web application used to collect annual employee reviews.

## Design Guidelines
- Code like an experienced web designer: prioritize balanced whitespace, consistent typography, and responsive layouts that stay polished on every screen size.
- When introducing new UI, consider accessibility first—maintain clear hierarchy, adequate contrast, and intuitive interaction states.

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

## Mobile + Desktop Compatibility
The entire site now uses a **mobile-first** design. Layouts rely on Tailwind CSS utilities along with Flexbox, CSS Grid and custom media queries so pages scale gracefully from phones to large monitors. Language toggling continues to work across all screen sizes.

### Testing Responsiveness
Use your browser's DevTools or a mobile emulator to resize the viewport. Keeping the width under **480&nbsp;px** closely simulates a phone.

## Automated Tests
This repository now includes a lightweight Node-based test suite. To run it locally:

```bash
npm test
```

The tests verify that production-safe styling utilities are defined locally and that the FullCalendar integration defensively checks for plugin availability.
