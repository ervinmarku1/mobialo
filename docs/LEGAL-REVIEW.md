# Legal review of the shop pages (22.10.2026)

**This is not legal advice.** It was written by a developer with an AI assistant, not by a lawyer.
It records what the pages say, how that compares with the running system, which rules were
checked, and what a qualified lawyer (Albanian and EU consumer and data protection law) and an
accountant must confirm before the texts are relied on.

## Scope

Pages reviewed and rewritten in Albanian, English and Italian (Italian was added; before, these
pages fell back to English for Italian visitors):

| Page | Source | Version shown |
| --- | --- | --- |
| Terms of use and sale | `dist/terms.html`, `dist/terms.js` | 22.10.2026 · v1.0 |
| Delivery & refund policy | `dist/delivery-refunds.html`, `dist/delivery-refunds.js` | 22.10.2026 · v1.0 |
| Privacy policy | `dist/privacy.html`, `dist/information.js` | 22.10.2026 · v1.2 |
| About, Compare (purchase description only) | `dist/about.html`, `dist/about-details.js`, `dist/information.js` | – |

The checkout consent checkbox (in `dist/paypal-checkout.js`) records `terms_version`
`v1.0-2026-10-22` (`TERMS_VERSION` in `scripts/hosted-checkout.mjs`). The Terms and the Delivery &
refund policy therefore keep version v1.0 of 22.10.2026; any later change to their text needs a new
version in both places. `scripts/i18n.test.mjs` fails if the pages and `TERMS_VERSION` disagree.

## The system the texts describe

Checked against the code and `supabase/DELIVERY-SETUP.md` on 22.10.2026, unless another source is
named:

- Seller: iSmart Shop & Service, NIPT L71614008L, Rruga Tom Plezha, Yzberisht, Tiranë (as already
  published on the about and terms pages). Contact: support@mobialo.eu. No telephone number.
- Buying: guest checkout with an email address in public mode; accounts (Supabase Auth) are optional
  and show the customer's orders. Plans needing identity verification cannot be bought.
- Consent: before PayPal opens the buyer must tick a box accepting the Terms and the Delivery &
  refund policy, requesting immediate delivery and acknowledging the loss of the withdrawal right on
  delivery. The server refuses orders without it and stores `terms_accepted_at` and `terms_version`.
- Payment: PayPal (the contracting PayPal entity is not confirmed; see "Facts to confirm before
  publishing"), PayPal wallet or PayPal's guest "Debit or Credit Card" form, which PayPal decides
  whether to offer to a buyer. Prices in EUR including processing costs; no surcharge at checkout.
- Delivery: after a completed capture the pg_cron worker (every minute) buys the eSIM from
  MobiMatter and emails the QR code, manual codes and instructions through Resend. A capture held as
  PENDING by PayPal is delivered once PayPal releases it. The legal texts make no delivery-time
  promise; the post-payment screen says the email usually arrives within a few minutes.
- Refunds and disputes: the verified PayPal webhook records refunds, reversals, denied captures and
  disputes on the order; a paid order the worker has not started yet moves to review, so no eSIM is
  bought, and the owner gets an alert. An order the worker has already claimed (`reserving` or
  later) only gets the flags, so its eSIM may still be delivered; delivery-refunds §9 says so. This
  works only once the extra webhook events are subscribed and migration
  `20261023110000_payment_events.sql` is applied (see "Before publishing"). Refunds themselves are
  made by hand in PayPal; nothing is refunded automatically.
- Data kept per order: delivery email, product, amount and currency, email language, PayPal order
  and capture IDs, payment and delivery status, refund and dispute details reported by PayPal
  (`payment_status`, `refunded_amount`, `dispute_id`, `dispute_status`), timestamps, consent time
  and version; for guest orders a keyed HMAC-SHA256 of the client IP (IPv6 by its /64), used only
  for the abuse limits (a one-hour window) and cleared after 7 days by a daily pg_cron job (see
  "Before publishing"). The hash is pseudonymised data, not anonymous: whoever holds the key can
  recover an IPv4 address by trying every address. MobiMatter receives the product ID and the
  internal order ID only.
- Hosting: Vercel (functions in `fra1`, Frankfurt; pages through Vercel's global network),
  Supabase (database and auth; region eu-central-1, Frankfurt, verified on 22.10.2026 through the
  Supabase Management API for project `kneqrmndtgpihrqkvunp`), Resend (email), Hostinger (the
  support@mobialo.eu mailbox, which also receives the webhook alerts with customer emails; public
  DNS checked on 22.10.2026: MX mx1/mx2.hostinger.com, SPF include:_spf.mail.hostinger.com). No
  analytics, advertising cookies or trackers. External content: Google Fonts, Unsplash, flagcdn,
  MobiMatter logo storage, and PayPal's SDK when checkout opens.

## Before publishing

### Checklist

The owner completes these before the pages and the checkout go live; until then the refund policy
and the privacy policy describe behaviour that is not yet running.

- [ ] PayPal live app: the webhook is subscribed, besides `PAYMENT.CAPTURE.COMPLETED`, to
  `PAYMENT.CAPTURE.PENDING`, `PAYMENT.CAPTURE.DENIED`, `PAYMENT.CAPTURE.REFUNDED`,
  `PAYMENT.CAPTURE.REVERSED`, `CUSTOMER.DISPUTE.CREATED`, `CUSTOMER.DISPUTE.UPDATED` and
  `CUSTOMER.DISPUTE.RESOLVED` (delivery-refunds §9 depends on them).
- [ ] Supabase: migrations `20261023100000_guest_checkout.sql` and
  `20261023110000_payment_events.sql` are applied (see `supabase/DELIVERY-SETUP.md`).
- [ ] Supabase: the daily pg_cron job that clears `client_ip_hash` after 7 days is scheduled (the
  privacy policy states this deletion).

### Facts to confirm before publishing

- **Contracting PayPal entity.** The owner checks the User Agreement shown in the PayPal business
  account (Legal agreements). The worldwide PayPal user agreement is with PayPal Pte. Ltd.
  (Singapore), but the agreement for Albanian merchant accounts could not be checked. Until it is
  confirmed, the privacy policy says only that PayPal processes payments as an independent
  controller under its own privacy statement; naming the entity later also needs a change to
  `scripts/i18n.test.mjs`.

## What was wrong and what changed

1. **Drafting notes read as terms.** Sentences such as "the final total ... must be shown before
   confirmation" or "expected delivery times must be disclosed before payment" described duties
   instead of stating what the shop does. They were replaced by concrete statements (EUR prices
   including processing costs, no checkout fee, automatic delivery after PayPal confirms payment,
   delivery after release of a pending payment).
2. **Withdrawal wording contradicted the new checkout.** The old texts said a waiver is never
   presumed and that no specific consent existed. They now describe the checkbox, say the right of
   withdrawal ends on delivery only because of the express request and acknowledgement in the
   checkout box (combined in one checkbox with accepting the Terms and the policy; accepting the
   general terms alone never removes it; see open point 17), keep statutory rights for
   non-delivery, non-conformity and double charges, and say the right remains until delivery (for
   example while PayPal holds the payment). No withdrawal period, refund amount or deadline was
   added (see the open points).
3. **Accounts were presented as required.** Terms, About, Compare and the storefront FAQ now say
   that an account is optional.
4. **Refund handling.** "An automatic refund system has not been enabled" was replaced by an
   accurate description: PayPal notices of refunds, reversals, denials and disputes are recorded
   automatically; one that arrives before we have started buying the eSIM from the supplier stops
   the delivery and the order is reviewed; if it arrives later, the eSIM may still be delivered and
   the order is reviewed; refunds are reviewed and paid through PayPal to the original payment
   method; nothing is refunded automatically.
5. **Privacy policy.** Rewritten from the actual data inventory: guest orders, the IP hash
   (pseudonymised, deleted after 7 days), the consent record and why it is kept, refund and dispute
   details, the absence of analytics and marketing, each provider with its role and location
   (PayPal as independent controller, MobiMatter without personal data, Resend, Hostinger for the
   support mailbox, Supabase and Vercel in Frankfurt), the server logs of the hosting and sign-in
   providers, the return page kept in the browser for up to two hours, transfers outside Albania
   and the EU, retention criteria, rights, the Albanian Commissioner (idp.al) and the EU
   authorities (for example the Garante in Italy), and a reference to the GDPR where it applies. The previous sentence "we do not claim all data stays in
   Albania or the EU" was replaced by naming the locations that are known.
6. **Governing law.** "Intended to operate under Albanian law" became "governed by Albanian law",
   keeping the consumer's mandatory protection where they live and not excluding non-excludable
   liability or court access. Each order is governed by the terms version accepted at checkout.
7. **Brand and legal naming.** The homepage footer now states "MOBIALO is operated by iSmart Shop &
   Service (NIPT L71614008L), Tirana, Albania" in all three languages, matching the about and legal
   pages. The About page names MOBIALO as the online shop operated by that entity.
8. **Indexing.** Terms and Delivery & refunds were `noindex`; all legal pages are now indexable,
   have canonical links and descriptions, and are listed in `dist/sitemap.xml`. The static title of
   `delivery-refunds.html` (it said "Kushtet e përdorimit") was corrected.
9. **No ODR link** is needed: the EU online dispute resolution platform and the duty to link to it
   ended on 20 July 2025 (Regulation (EU) 2024/3228).
10. **Second review of the copy (22.10.2026).** The privacy policy no longer names an unconfirmed
    PayPal entity and adds the items listed in point 5. The terms now say that the eSIM is supplied
    digitally by email after payment (no legal classification and no "immediately", see open
    point 2), that the buyer confirms the delivery email shown at checkout (the account email when
    signed in), that PayPal or the bank may charge conversion or card fees, and that activation
    conditions are shown where the supplier provides them. The delivery page now carries the name
    the checkout consent uses (Delivery & refund policy / Politika e dërgesës dhe rimbursimit /
    Politica di consegna e rimborso). The post-payment screen says the email usually arrives within
    a few minutes, the checkout note says card payment is usually possible without a PayPal
    account, the sign-in page says only that sign-in uses an encrypted connection, the guest email
    field links to the privacy policy, and the delivery email confirms the consent (open point 1).
    Version v1.0 has never been published, so it was kept.

## Rules checked

- Consumer Rights Directive 2011/83/EU, Article 16(m) as replaced by Directive (EU) 2019/2161: no
  withdrawal for digital content not on a tangible medium once performance has begun and, for paid
  contracts, the consumer gave prior express consent to begin during the withdrawal period,
  acknowledged losing the right, **and** the trader provided the confirmation under Article 7(2) or
  8(7). Article 6(1)(c) as replaced lists the trader's geographical address, **telephone number**
  and email address among the pre-contractual information. Article 14(4)(b)(i): without prior
  express consent the consumer owes nothing for digital content supplied during the withdrawal
  period. Sources: [2019/2161 Article 4](https://www.legislation.gov.uk/eudr/2019/2161/article/4),
  [2011/83 Article 16 (original)](https://www.legislation.gov.uk/eudr/2011/83/article/16),
  [2011/83 Article 8](https://www.legislation.gov.uk/eudr/2011/83/article/8),
  [Official Journal, 2019/2161](https://eur-lex.europa.eu/eli/dir/2019/2161/oj).
- Digital Content Directive (EU) 2019/770, Article 3(5)(b): the Directive does not apply to
  electronic communications services as defined in Directive (EU) 2018/1972 (which include internet
  access services). Source:
  [2019/770 Article 3](https://www.legislation.gov.uk/eudr/2019/770/article/3).
- Directive (EU) 2023/2673 adds Article 11a to the Consumer Rights Directive (a withdrawal function
  for contracts concluded online), which has applied since 19 June 2026 according to secondary
  sources ([iubenda summary](https://www.iubenda.com/en/blog/the-new-online-withdrawal-function-what-eu-directive-2023-2673-means-for-your-business/),
  Taylor Wessing, SKW Schwarz, the European Parliament's Legislative Observatory); the official
  text was not retrieved and must be checked.
- GDPR (Regulation (EU) 2016/679): Article 3(2) (offering services to people in the EU from outside
  the EU) and Article 27 (EU representative, with the exemption for occasional, low-risk processing).
  The Art 27(2)(a) exemption is unlikely to apply to routine sales (EDPB Guidelines 3/2018, section
  4, read "occasional" as processing not carried out regularly and outside the regular course of
  business). If a representative is appointed, add its name and contact to the privacy policy
  (Article 13(1)(a)).
  Sources: [GDPR on EUR-Lex](https://eur-lex.europa.eu/eli/reg/2016/679/oj),
  [Article 27](https://gdpr-info.eu/art-27-gdpr/).
- Albania, personal data: Law No. 124/2024 "On personal data protection", in force since early 2025
  (31 January or 1 February 2025 depending on the source), aligned with the GDPR, supervised by the
  Commissioner for the Right to Information and Personal Data Protection (idp.al). It was published
  in Official Gazette No. 9 of 17.01.2025, and some articles apply only from 17.01.2027 (secondary
  sources: KPMG, offlist). Sources (secondary; confirm in the Official Gazette):
  [EY Albania](https://www.ey.com/en_al/insights/law/albania-data-protection-commissioner-under-the-new-data-protection-law),
  [compliance timeline](https://www.privaxisos.al/resources/law-124-2024-compliance-timeline/).
- Albania, consumers: Law No. 9902 of 17.4.2008 "Për mbrojtjen e konsumatorëve", as amended (among
  others by Law No. 71/2018); a government draft for a new consumer protection law (creating a
  national consumer protection agency) was reported in October 2026 as still a draft. Sources:
  [consolidated text 2018](https://aac.gov.al/wp-content/uploads/2024/12/Ligji-9902-date-17.04.2008-i-ndryshuar-version-i-konsoliduar-2018.doc),
  [Law 71/2018](https://erru.al/doc/Ligji_nr_71-2018_date_18.10.2018_Per_disa_shtesa_dhe_ndryshime_ne_ligjin_nr_9902_date_17.04.2008.pdf),
  [draft law, 19.10.2026](https://skyweb.al/2026/10/19/projektligji-i-ri-per-mbrojtjen-e-konsumatorit-gjoba-deri-ne-600-mije-leke-per-bizneset/).
  Whether the Albanian text contains the same digital-content exception could not be read (the
  consolidated file is not machine-readable here), so the customer pages refer to Albanian law only
  generically.
- ODR: [Regulation (EU) 2024/3228](https://eur-lex.europa.eu/eli/reg/2024/3228/oj/eng).
- EU VAT for B2C services from non-EU sellers (customer's country; non-Union OSS):
  [Irish Revenue, non-Union scheme](https://revenue.ie/en/vat/vat-ecommerce/non-union-scheme/index.aspx).

## Points a lawyer (or accountant) must confirm

1. **Confirmation on a durable medium (most urgent).** Article 16(m)(iii) makes the withdrawal
   exception depend on a confirmation under Article 8(7) that includes the consent and the
   acknowledgement. The delivery email (`scripts/delivery-template.mjs`) now carries the line below
   before the QR code, with the terms version and the acceptance time (UTC) stored with the order
   (`terms_version`, `terms_accepted_at`); it is left out for an order that recorded no consent:
   - EN: "You accepted the Terms and the Delivery & refund policy (version v1.0-2026-10-22),
     requested immediate delivery of this eSIM and acknowledged that you lose your right of
     withdrawal once it is delivered."
   - SQ: "Ke pranuar Kushtet dhe Politikën e dërgesës dhe rimbursimit (versioni v1.0-2026-10-22),
     ke kërkuar dërgimin e menjëhershëm të këtij eSIM-i dhe ke pranuar se humbet të drejtën e
     tërheqjes pasi ai dërgohet."
   - IT: "Hai accettato i Termini e la Politica di consegna e rimborso (versione v1.0-2026-10-22),
     hai richiesto la consegna immediata di questa eSIM e hai riconosciuto di perdere il diritto di
     recesso una volta consegnata."
   Confirm whether a confirmation sent together with the eSIM is in time, and whether the email
   should also carry the terms text or a link to the archived version. Article 8(7)(a) also
   requires the Article 6(1) information (trader identity, geographical address, contact details,
   total price, main characteristics, withdrawal information), unless it was already given on a
   durable medium, and the confirmation must arrive at the latest before performance begins; a line
   inside the eSIM email arrives at the same moment as performance. Consider a separate
   order-confirmation email sent at capture (before the worker buys the eSIM) with the consent
   line, `terms_accepted_at`, terms version v1.0-2026-10-22, trader identity and address, plan,
   total, and the terms text as an attachment or copy.
2. **Classification of the eSIM (urgent, like point 1).** Digital content (Article 16(m)) or an
   electronic communications service (Article 16(a) with Article 14(3), possibly a pro-rata
   payment), and the equivalent under Albanian law. Directive (EU) 2019/770, Article 3(5)(b),
   excludes electronic communications services (which include internet access services) from that
   Directive, so the classification is open. Terms §7 therefore no longer calls the eSIM digital
   content; it says only that the eSIM is supplied digitally by email after payment. Confirm the
   consent wording works for both classifications.
3. **Withdrawal before delivery.** Article 11a has applied since 19 June 2026. Today, withdrawal
   before delivery is possible only by email (delivery-refunds §6). Confirm urgently whether an
   online withdrawal function is required for undelivered orders, and add the 14-day period and the
   model withdrawal form (Art 6(1)(h)).
4. **Telephone number.** Article 6(1)(c) as amended lists it; none is published. Decide whether to
   publish one. The CJEU's Amazon ruling of 10 July 2019 (C-649/17,
   [press release 89/19](https://curia.europa.eu/jcms/upload/docs/application/pdf/2019-07/cp190089en.pdf))
   concerned the earlier wording ("where available").
5. **Legal entity.** Confirm the exact registered name and legal form of "iSmart Shop & Service"
   (PayPal correspondence used "iSmart AL"), that NIPT L71614008L and the address are current, and
   that the PayPal display name and card statement descriptor read MOBIALO.
6. **VAT and price statements.** Whether the seller is VAT-registered in Albania; whether sales of
   eSIM plans to EU consumers make VAT due in the customer's member state (non-Union OSS); whether
   "prices include processing costs" must also say whether VAT is included (Article 6(1)(e)).
7. **GDPR set-up.** Whether an EU representative under Article 27 is needed (the Art 27(2)(a)
   exemption is unlikely to apply to routine sales, EDPB Guidelines 3/2018, section 4; if a
   representative is appointed, add its name and contact to the privacy policy); data processing
   agreements with Vercel, Supabase, Resend, Hostinger (support mailbox, which also receives the
   webhook alerts with customer emails) and MobiMatter; the transfer mechanism for providers in the
   United States or Singapore (from the EU and under Albanian Law 124/2024), including where
   Hostinger processes the mailbox; records of processing. Legal basis: under the GDPR an Article
   6(1)(c) "legal obligation" must come from EU or Member State law (Article 6(3)), so for EU buyers
   Albanian accounting and tax retention would rest on legitimate interests; the privacy policy says
   "legal obligation" (transaction records, consent record). Confirm the bases to state.
8. **Retention periods.** Concrete periods for orders, consent records, support emails and
   accounts, including Albanian accounting and tax retention. The policy states criteria only,
   except for the IP hash: the abuse limits need it for one hour, and it is cleared after 7 days by
   a daily pg_cron job, as the privacy policy now says (see "Before publishing").
9. **Contract formation.** The terms say the order is binding once PayPal confirms the payment.
   Confirm this moment and its interplay with the consent and the withdrawal period.
10. **Delivery time.** Owner decision: whether to promise a time. The system normally runs every
    minute; the legal texts promise nothing, and the post-payment screen gives only an estimate
    (the email "usually" arrives within a few minutes).
11. **Refund rules.** Owner decisions not invented here: refunds for an eSIM that was never
    installed, partial refunds, unused data, refund deadlines, and what happens after a lost
    PayPal dispute.
12. **Complaints body.** Name the competent Albanian consumer authority (under Law 9902 and, once
    adopted, the new law) and any ADR body; the pages refer to "the competent consumer-protection
    authority" only.
13. **Third-party content.** Fonts, photos, flags and supplier logos load from third parties and
    receive the visitor's IP address before any interaction. Consider self-hosting them; the
    privacy policy discloses the current state. LG München I, 20.01.2022, 3 O 17493/20, held that
    loading Google Fonts from Google's servers without consent breached the GDPR.
14. **Italian and Albanian legal translations.** Have the Italian and Albanian texts checked by a
    native-speaking lawyer; the English text was the drafting basis.
15. **Accessibility.** Check whether the European Accessibility Act applies to the shop (it has an
    exemption for microenterprises); the colour contrast was brought to WCAG AA in the same change.
16. **Archive of versions.** Keep a copy of every published terms version (Git history of
    `dist/terms.js` and `dist/delivery-refunds.js` today) so the version stored with each order can
    be produced.
17. **One combined checkbox.** Confirm that one checkbox combining acceptance of the Terms with the
    express request and the acknowledgement satisfies Art 16(m)(i)-(ii) and the Albanian
    equivalent, or whether a separate, unticked checkbox is required. The checkbox wording is
    owner-mandated.
