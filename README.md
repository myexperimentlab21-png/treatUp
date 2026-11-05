# TreatUp 🎉

A small web app for our group: vote on the treat, pick your dish, join the cake or gift, split the bill, and see who owes what.

- **Frontend:** plain HTML, CSS and JavaScript (hosted free on GitHub Pages)
- **Backend:** Google Apps Script
- **Database:** a Google Sheet (4 tabs: People, Events, Responses, Ledger)

Later, the backend can be swapped for Node + a real database by rewriting only `js/api.js`.

```
treatup/
├── index.html
├── css/style.css
├── js/
│   ├── config.js   ← paste your web app URL here
│   ├── api.js      ← the only file that talks to the backend
│   └── app.js      ← all the screens and logic
└── backend/
    └── Code.gs     ← paste this into Apps Script
```

---

## Part 1: Create the Google Sheet (5 min)

1. Go to **sheets.new** to make a new, empty Google Sheet.
2. Name it **TreatUp DB**.
3. Don't add anything yourself. The script will create the tabs.

> Keep this sheet private (don't share the link). Only the script needs to read it.

## Part 2: Add the backend script (10 min)

1. In the sheet, click **Extensions → Apps Script**.
2. Delete everything in `Code.gs` and paste in the whole of `backend/Code.gs`.
3. At the top, change the PIN to your own secret number:
   ```js
   const ADMIN_PIN = '1234'; // CHANGE THIS
   ```
4. Click **Save** (the disk icon).
5. In the function dropdown next to **Run**, choose `setup`, then click **Run**.
   - Google will ask for permission. Click **Review permissions → your account → Advanced → Go to (project name) → Allow**. This is normal for your own scripts.
   - Go back to the sheet. You should now see 4 tabs: **People, Events, Responses, Ledger**.
6. Choose `seedPeople` and click **Run**. This adds the 17 people from the old tracker.
7. *(Optional)* Choose `importOldHistory` and click **Run**. This brings in the 5 past events from the old ASGT tracker (Ashwin, Jemy, Fayiz, Justin's gift, Sahin) with who paid and who is still pending. It stops by itself if the data is already there.
8. You can delete the empty "Sheet1" tab.

Add new people from the app's **Admin** tab. You can also type a name straight into the People tab: leave the `id` cell empty and the app fills it in the next time it loads. Phone numbers can be added the same way. Use the full number with country code and no `+`, like `971501234567`.

## Part 3: Publish the backend as a web app (5 min)

1. In Apps Script, click **Deploy → New deployment**.
2. Click the gear icon next to "Select type" and choose **Web app**.
3. Set:
   - **Execute as:** Me
   - **Who has access:** Anyone
4. Click **Deploy**, allow permissions again if asked.
5. Copy the **Web app URL**. It ends with `/exec`.

Quick test: paste that URL in your browser and add `?action=data` at the end. You should see text starting with `{"ok":true`.

> ⚠️ **Important:** every time you change `Code.gs`, you must publish a new version, or the app keeps using the old code:
> **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy.**
> The URL stays the same.

## Part 4: Connect the frontend (2 min)

Open `js/config.js` and paste your URL:

```js
export const API_URL = 'https://script.google.com/macros/s/XXXX/exec';
```

## Part 5: Put it online with GitHub Pages (10 min)

1. Create a new repository on GitHub, for example `treatup`.
2. Upload `index.html`, `README.md` and the `css` and `js` folders. **Don't upload `backend` or `tools`**: the website doesn't need them, and `Code.gs` lists who owes what.
3. In the repo go to **Settings → Pages**.
4. Under "Branch" choose **main** and **/ (root)**, then **Save**.
5. After a minute your app is live at `https://YOUR-USERNAME.github.io/treatup/`.

> To test on your laptop before uploading, the app needs a small local server because it uses JS modules. In VS Code use the **Live Server** extension, or run `npx serve .` in the folder. Opening `index.html` by double-click will not work.

## Updating the backend code

When you get a new `Code.gs`:
1. In Apps Script, select all the old code, delete it, paste the new code.
2. Put your own PIN back on the `ADMIN_PIN` line, then **Save**.
3. **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy.** The URL stays the same.

## Part 6: First use

1. Open the app, go to **Admin**, enter your PIN.
2. Click **+ New event**, pick the birthday person, tick "giving a treat", choose Cake / Gift.
3. On the event page, tap **Share event in WhatsApp group**.

---

## How an event works

| Step | Members do | You (admin) do |
|---|---|---|
| **Place** | Vote KFC / Biriyani / Mandi, suggest something, or go with majority. Say yes/no to the cake. | Watch the votes. When ready: **Lock place**. Edit the dish list if needed. |
| **Dishes** | Pick Chicken / Beef / Mutton (or not eating). | When it's time to order: **Close & make buying list**. |
| **Order** | — | **Copy buying list** or send it on WhatsApp. Buy the cake/gift. |
| **Done** | See the bill, their share, photos. | Upload bill photos, enter the total, **Split & add to accounts**. Share the summary. |

Events without a treat (cake or gift only) skip straight to collecting.

**Payments:** when someone pays you, go to **Balances**, tap their name, enter the amount, **Record payment**. The **Remind** button opens WhatsApp with a ready message.

**Rules built in**
- The birthday person never pays for their own cake/gift.
- Votes and dishes can be changed until you close that step.
- A bill can only be split once. To fix a mistake, edit the Ledger tab in the sheet directly.
- Shares are rounded to 2 decimals, so the total can be off by a few fils.

## Good to know

- **Speed:** each save takes 1–3 seconds. That's normal for Apps Script.
- **Privacy:** phone numbers are only sent to the app when you're logged in as admin. Balances are visible to everyone in the group.
- **Security:** members don't log in, so anyone with the link could answer as someone else. Fine for friends; a real login comes with the Node version.
- **Photos** go to a Google Drive folder called "TreatUp Uploads", viewable by anyone with the link. **Videos:** put them in a Google Photos album and paste the album link in the event.
- **Fixing data:** the sheet *is* the database. You can correct anything by editing a cell. Don't rename the tabs or the header row.

## Moving to Node later

Every backend action lives in `js/api.js` (frontend) and `backend/Code.gs` (backend). To switch:

1. Build the same actions as Express routes (`getData`, `respond`, `createEvent`, `setWinner`, `splitBill`, …).
2. Make 4 database tables with the same columns as the sheet tabs, and import the sheet data.
3. Rewrite the functions in `js/api.js` to call your new routes.

`app.js` and the screens don't need to change.
