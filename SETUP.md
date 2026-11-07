# PocketBudget v4 — setup (about 20 minutes, once)

The new PocketBudget runs on your phone and laptop by itself: no laptop server, no internet needed.
When a device is online it syncs with your free Supabase account.

Your old app and `budget.db` are not touched. Keep them as a backup.

---

## 1. Supabase (where your data syncs)

1. Sign in at **supabase.com** and open your **PocketBudget** project.
2. Left menu → **SQL Editor** → **New query**. Open `supabase_setup.sql` from this folder, paste everything, press **Run**. You should see *Success*.
3. Left menu → **Authentication** → **Users** → **Add user** → **Create new user**. Enter your email and a password, tick **Auto Confirm User**, then save. This is the login for your phone and laptop.
4. **Authentication** → **Sign In / Providers** → turn **off** “Allow new users to sign up”, so nobody else can create an account in your project.
5. Your Project URL and publishable key are already built into the app, so there's nothing to copy.

## 2. GitHub (gives the app a secure web address you can install from)

1. Sign in at **github.com** → **+** (top right) → **New repository**.
   Name: `pocketbudget` · **Public** (free GitHub Pages needs public; this is only the app code, never your data) → **Create repository**.
2. On the repo page click **Add file → Upload files**. Select **all the files** in this folder (they're all at the top level) and drag them in. Press **Commit changes**.
   Then create the publishing file: **Add file → Create new file**, type the name `.github/workflows/deploy.yml` (the slashes create the folders), paste the contents of `deploy.yml`, and press **Commit changes**.
3. Repo → **Settings** → **Pages** → under *Build and deployment* set **Source: GitHub Actions**.
4. Repo → **Actions** tab. Wait until “Publish PocketBudget” shows a green tick (1–2 minutes).
   Your app is now at **https://YOUR-USERNAME.github.io/pocketbudget/**

## 3. Bring your existing data across (laptop, once)

1. Copy `export_for_v4.py` into your old app folder (the one with `budget.db`).
2. In that folder, in PowerShell:
   ```powershell
   .\.venv\Scripts\Activate.ps1
   python export_for_v4.py
   ```
   It only **reads** your old data and creates `pocketbudget-import.json`.

## 4. Laptop

1. Open your app link in **Chrome or Edge** → click the **install icon** in the address bar (or menu → *Install PocketBudget*).
2. In the app: **Sync & settings** → **Restore / import backup** → choose `pocketbudget-import.json`.
3. Same screen: enter your **email** and **password** (the user you created in step 1.3) → **Sign in & sync**.
4. **Prepare for offline** (receipt reader, about 10 MB, once).

## 5. Phone

1. Open the same link in **Chrome** → menu **⋮** → **Install app** (or *Add to Home screen*).
2. Open PocketBudget from your home screen → **Sync & settings** → sign in with the same email and password. All your data arrives.
3. Tap **Prepare for offline**.

From now on, use PocketBudget on either device, online or offline. Stop using the old laptop app so your data doesn't split between two places.

---

### Good to know
- **Backups:** *Sync & settings → Download backup* saves everything (including photos) in one file. Do it now and then.
- **Supabase pausing:** free projects pause after about a week with no use. If sync says it can't connect after a long break, open supabase.com and press **Restore project**. Your devices keep working offline in the meantime, and nothing is lost.
- **Updates:** when you upload changed files to GitHub, the app updates itself the next time it opens online.
- **Scanning:** reading happens on the device. One receipt per photo works best.
