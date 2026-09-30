# House Ready 2028 — family board

A password-protected version of the house-prep board for Netlify. Family members enter the shared password, pick their name, and every change is logged with who made it.

## What's in here

- `public/index.html` — the board (kanban, season plan, sortable list, recent changes)
- `netlify/functions/api.mjs` — the small server that checks the password and saves changes
- `netlify/lib/board.mjs` — the board logic (password check, saving, change log)
- `netlify/lib/seed.mjs` — your projects as of Sept 30, 2026. Only used the very first time the site runs.

The password is **not** in any of these files. It lives in a Netlify setting, so it never ends up on GitHub.

## Set it up (about 15 minutes)

### 1. Put the folder on GitHub (private)
1. Go to github.com/new.
2. Name it something like `house-ready-board` and choose **Private**. This matters.
3. Click **Create repository**, then **uploading an existing file**.
4. Unzip this folder on your computer and drag *everything inside it* (including the `netlify` and `public` folders) onto the upload page. Click **Commit changes**.

If you use git instead: `git init`, `git add .`, `git commit -m "Board"`, then push to the new private repo.

### 2. Connect it to Netlify
1. In Netlify: **Add new site → Import an existing project → GitHub**, then pick `house-ready-board`. You may need to give Netlify access to that private repo.
2. Leave the build settings as they are. `netlify.toml` already sets them (no build command, publish folder `public`).
3. Click **Deploy**.

### 3. Set the password
1. In the site: **Site configuration → Environment variables → Add a variable**.
2. Add `BOARD_PASSWORD` with the value `BabeCave202o`. If Netlify offers "Contains secret values", turn it on.
3. Optional but recommended: add `BOARD_SECRET` with any long random text (mash the keyboard for 30+ characters). It makes sign-in tokens harder to forge.
4. Go to **Deploys → Trigger deploy → Deploy site** so the new settings take effect.

### 4. Try it
Open your Netlify link, enter the password, and pick **Jasmine**. Then send the link and password to your family. The first time each person signs in, they type their name once. After that they pick it from the list.

## Good to know

- **Who can see it:** only people with the password. The page itself loads for anyone who has the link, but it's an empty shell. No project data is sent until the password checks out. Search engines are told not to index it.
- **Sign-ins last 60 days** on each device. "Sign out" in the top right ends one right away.
- **Changing the password:** update `BOARD_PASSWORD` in Netlify and redeploy. Everyone gets signed out and needs the new one.
- **Names are on the honor system.** Anyone with the password can pick any name, which is fine within a family but isn't proof of identity.
- **Updates from others** show up within about 20 seconds, or right away when you switch back to the tab.
- **Your data** is stored in Netlify Blobs on your site. Redeploying or editing the code doesn't erase it.
- This is separate from the version in Claude. Edits in one don't show up in the other, so pick the Netlify one as the main board once it's live.
