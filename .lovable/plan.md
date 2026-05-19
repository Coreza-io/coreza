# Stop the Header search from being autofilled with the user's email

## What's happening

On the Settings → Security tab there's a "Current password" `<input type="password">` with no surrounding `<form>`, no `name`, and no `autoComplete` attribute. When Chrome/Edge sees an unlabeled password field, it looks for the nearest text input on the page to use as the matching "username" field and autofills it with the saved email. The nearest text input is the global search bar in the Header — so the moment you click the Security tab and the password field mounts, the browser pastes your email into the search box.

This is purely a browser-autofill artifact, not a bug in the search logic. Two small fixes on the markup side stop it.

## What changes

1. **`src/components/layout/Header.tsx`** — on the global search `<Input>` (line ~95):
   - `type="search"`
   - `name="global-search"`
   - `autoComplete="off"`
   - `aria-label="Search workflows, projects"`
   
   This signals to the browser that this field is unrelated to credentials so it stops being a candidate for username autofill.

2. **`src/pages/Settings.tsx`** — on the Security tab password block (lines ~295–304):
   - Wrap the Change Password label + input + button in a `<form autoComplete="off" onSubmit={(e) => e.preventDefault()}>`.
   - Add a hidden username field bound to the user's email so the browser has a clear target and never reaches outside the form: `<input type="text" name="username" autoComplete="username" value={user?.email ?? ""} readOnly hidden />`.
   - On the password `<Input>`: `name="current-password"`, `autoComplete="current-password"`.
   - (Pull `user` from `useAuth()` — already used in other pages.)

No other files, no business logic, no styling changes.

## Verification

- Reload the app, log in, go to Settings → click Security tab → the Header search bar stays empty.
- Switch between General / Notifications / Security / Privacy several times — search bar never gets repopulated.
- The password field itself still accepts autofill from the password manager correctly.
- Light/dark theme unchanged; no console warnings.
