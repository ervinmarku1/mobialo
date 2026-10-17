# Multilingual Supabase emails

Paste the complete confirm-signup.html into Supabase Authentication ? Emails ? Confirm sign up ? Body. Paste reset-password.html into Reset password ? Body. Use the neutral subject `MOBIALO ? eSIM`. Save each template. Deploying the website does NOT install these templates.

There are 36 supported languages in languages.json. scripts/locale.mjs maps the Vercel IP country to an email language; multilingual countries use Accept-Language among the country?s configured languages. Unknown countries use a supported browser language or English. Explicit EN/SQ choices always take priority. No IP address is stored.

Signup saves the resolved email language in user_metadata.language. Both templates choose that language, falling back to English for missing/unsupported metadata. Recovery follows the language saved at registration, not a new IP. Existing users keep their stored language. Country detection is approximate and may reflect VPN/proxy location.

Website translations remain EN/SQ/IT; email translations have separate coverage. This is broad multilingual coverage, not a translation engine for every language. Regenerate after edits with `node scripts/build-email-templates.mjs`. Preserve ConfirmationURL. No real registration or email is sent by the generator or tests.
