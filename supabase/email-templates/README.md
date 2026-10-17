# Supabase multilingual email setup

In Authentication ? Emails ? Templates, paste confirm-signup.html into Confirm sign up ? Body. Use the neutral subject `MOBIALO ? eSIM` and save. Paste reset-password.html into Reset password ? Body, with the same neutral subject. Preserve the ConfirmationURL variable exactly.

The language is taken from user_metadata.language, set by the signup form after geolocation or the visitor?s explicit EN/SQ choice. Italy ? it; Albania/Kosovo ? sq; other/unknown ? en. Recovery follows the language saved at registration, not a newly detected IP. Older users without language metadata receive English. Templates do not change permissions or authorization.

These files must be applied in the Supabase dashboard; deploying the website does not install them. Verify with an actual signup after saving. No test emails have been sent automatically.
