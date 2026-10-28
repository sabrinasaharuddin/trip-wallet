# Korea Trip Wallet: setup guide

An offline expense tracker for the South Korea trip (6–12 Nov 2026). It runs in Safari and is installed on the iPhone Home Screen. It needs no account and no internet once it is installed.

## What's set up

| Category | Budget (₩) | Budget (RM) |
|---|---:|---:|
| Sabrina Shopping | 278,895.18 | 788.08 |
| T-Money | 60,000 | 169.54 |
| Souvenir Shopping | 201,492.70 | 569.37 |
| Hanbok Rental | 10,000 | 28.26 |
| Photobooth | 8,000 | 22.61 |
| Meal | 164,000 | 463.42 |
| **Total** | **722,387.88** | **2,041.28** |

- Rate: RM1.00 = ₩353.89. It's fixed and never fetched live. Change it in ⚙️ Settings.
- Budgets are stored in won. RM figures are worked out from won at the current rate.
- If you edit budgets so they no longer add up to ₩722,387.88, the app shows a note instead of changing anything.
- The app starts with no expenses.

## 1. Put it online (once, free)

The iPhone needs to load the app from an **https** web address once, so it can save a copy for offline use. Pick one option:

**Option A: GitHub Pages (recommended; it stays up)**
1. Create a free account at github.com and sign in.
2. Click **+ → New repository**. Name it, for example, `trip-wallet`, set it to **Public**, then click **Create**.
3. Click **uploading an existing file**. Drag in **everything inside this folder**, including the `icons` folder. Click **Commit changes**.
4. Go to **Settings → Pages**. Under "Branch", choose **main** and **/(root)**, then **Save**.
5. Wait 1–2 minutes. Your address is `https://YOUR-USERNAME.github.io/trip-wallet/`.

**Option B: Netlify**
1. Create a free account at app.netlify.com.
2. Go to **Add new site → Deploy manually**, then drag this whole folder onto the page.
3. You'll get an address like `https://something.netlify.app`.

The web address is public, but your expenses are not. They stay only on your phone and never go to the website.

## 2. Install on the iPhone

1. Open the address in **Safari**. Chrome won't work for this.
2. Tap the **Share** button (the square with an arrow), then **Add to Home Screen**, then **Add**.
3. Open **Trip Wallet** from the Home Screen icon once while you're online, and wait about 5 seconds.
4. Test it: turn on **Airplane Mode**, close the app, open it again from the icon, and add a test expense. Then delete the test expense.

**Always use the Home Screen icon.** The icon and a Safari tab keep **separate** data, so anything entered in a Safari tab won't show up in the app.

## 3. Back up (please read)

Your data is saved only on this iPhone. There's no cloud copy.

- Deleting the app icon, clearing Safari website data (Settings → Safari → Clear History and Website Data), or losing the phone **will delete your expenses**.
- To back up, go to ⚙️ Settings, tap **Export backup (JSON)**, then **Save to Files** (iCloud Drive is best). Do this **every evening** of the trip. The Home screen reminds you when your last backup is more than a day old.
- **Export for Excel (CSV)** opens in Excel after the trip.
- **Import backup (JSON)** restores data. It asks whether to **Merge**, which only adds what's missing, or **Replace**, which wipes the phone's data first. It also checks the file before changing anything.

## Updating the app later (only if the files change)

1. In `sw.js`, change `VERSION` (for example to `v1.0.3`). Upload the changed files to the same place.
2. On the phone, open the app online, close it, and open it again. Your expenses are kept.
