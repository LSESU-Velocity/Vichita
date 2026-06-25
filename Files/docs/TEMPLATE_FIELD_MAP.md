# Template Field Map

Last updated: 2026-06-19

This file maps the tagged placeholders added to the official LSESU template copies. Use these tagged copies for automation; keep the official raw files untouched.

> The tagged template files referenced below are kept local and are **not committed** to the public repository (they are redistribution-sensitive; see `../templates/README.md` and the Template Policy in the root `README.md`). The `templates/tagged/...` paths below are the expected local locations. Other societies should bring their own SU's templates and tag them to match these placeholders.

## 1. Risk Assessment Template

File: `templates/tagged/Risk-Assessment-Template-LSESU-TAGGED.docx`

### Key details

| Tag | Meaning |
|---|---|
| `{{society_name}}` | Usually `LSESU Velocity`. |
| `{{event_name}}` | Event name. |
| `{{event_organiser_name}}` | Student lead / organiser. |
| `{{event_organiser_lse_email}}` | LSE email of organiser. |
| `{{event_organiser_contact_number}}` | Contact number if required. |
| `{{event_dates_times}}` | Date/time including setup time. |
| `{{event_location}}` | Room/location or TBC if not final. |
| `{{first_aid_plan}}` | First aider name or first-aid plan. Missing value blocks final readiness. |
| `{{date_completed}}` | Date draft risk assessment completed. |

### Risk loops

Core risks loop:

```text
{{#core_risks}}
{{hazard_identified}}
{{why_hazard}}
{{who_at_risk}}
{{risk_score}}
{{actions_before_event}}
{{actions_during_event}}
{{owner}}
{{/core_risks}}
```

Activity risks loop:

```text
{{#activity_risks}}
{{hazard_identified}}
{{why_hazard}}
{{who_at_risk}}
{{risk_score}}
{{actions_before_event}}
{{actions_during_event}}
{{owner}}
{{/activity_risks}}
```

## 2. Budget Template

File: `templates/tagged/NEW-Budget-Template-1-TAGGED.xlsx`

| Tag pattern | Cells | Meaning |
|---|---|---|
| `{{society_name}}` | `Budget Template!C3` | Society name. |
| `{{event_project_name}}` | `Budget Template!C4` | Event/project name. |
| `{{expenditure_01_description}}` to `{{expenditure_10_description}}` | `B7:B16` | Expense descriptions. |
| `{{expenditure_01_price_per_item}}` to `{{expenditure_10_price_per_item}}` | `C7:C16` | Numeric price per item. |
| `{{expenditure_01_quantity}}` to `{{expenditure_10_quantity}}` | `D7:D16` | Numeric quantity. |
| `{{expenditure_01_notes}}` to `{{expenditure_10_notes}}` | `F7:F16` | Notes/assumptions. |
| `{{income_member_ticket_price_per_item}}` | `C20` | Member ticket price. |
| `{{income_member_ticket_quantity}}` | `D20` | Member ticket quantity. |
| `{{income_non_member_ticket_price_per_item}}` | `C21` | Non-member ticket price. |
| `{{income_non_member_ticket_quantity}}` | `D21` | Non-member ticket quantity. |
| `{{income_non_lse_ticket_price_per_item}}` | `C22` | Non-LSE ticket price. |
| `{{income_non_lse_ticket_quantity}}` | `D22` | Non-LSE ticket quantity. |
| `{{income_sponsorship_price_per_item}}` | `C23` | Sponsorship amount per unit. |
| `{{income_sponsorship_quantity}}` | `D23` | Sponsorship quantity. |
| `{{income_society_account_price_per_item}}` | `C24` | Society account contribution amount. |
| `{{income_society_account_quantity}}` | `D24` | Usually `1` if used. |
| `{{income_suf_requested_price_per_item}}` | `C25` | SUF requested amount. |
| `{{income_suf_requested_quantity}}` | `D25` | Usually `1` if used. |
| `{{income_other_income_price_per_item}}` | `C26` | Other income amount. |
| `{{income_other_income_quantity}}` | `D26` | Quantity for other income. |
| `{{income_*_notes}}` | `F20:F26` | Notes/assumptions. |

Formula cells to preserve:

- `E7:E16` line-item expenditure totals.
- `E17` total expenditure.
- `E20:E26` line-item income totals.
- `E27` total income.
- `C30` overall profit/loss.

Numeric write rule:

- Price, quantity, income, sponsorship, society-account contribution, SUF requested, and other-income cells must be written as real numbers, not text.
- In `.xlsx` generation, set numeric cell values with numeric types and preserve formulas in total cells.
- In Google Sheets writes/imports, verify that formulas recalculate as numbers.
- Required test: a generated sample budget with non-zero inputs must produce non-zero line totals, total expenditure, total income, and profit/loss.
- Do not treat "formula cells exist" as sufficient verification.

## 3. Sponsorship Contract Template

File: `templates/tagged/LSESU-Sponsorship-Contract-Template-2025-26-TAGGED.docx`

Sponsorship is v2, not true MVP.

| Tag | Meaning |
|---|---|
| `{{contract_date}}` | Contract draft/signature workflow date. |
| `{{student_group_name}}` | Usually `LSESU Velocity`. |
| `{{sponsor_company_name}}` | Legal sponsor/company name. |
| `{{sponsor_company_address}}` | Registered/company address. |
| `{{sponsorship_start_date}}` | Sponsorship start date. |
| `{{sponsorship_end_date}}` | Sponsorship end date; verify current academic year. |
| `{{sponsorship_amount_inclusive_vat}}` | Invoice amount inclusive of VAT where applicable. |
| `{{invoice_company_address}}` | Address to use on invoice. |
| `{{payment_due_date}}` | Payment due date if known; otherwise TBC. |
| `{{promotional_email_count}}` | Number of agreed promotional emails, if any. |
| `{{sponsored_event_count}}` | Number of agreed sponsored/collaborative events, if any. |
| `{{sponsor_distinction_from_other_sponsors}}` | How sponsor is distinguished from other sponsors. |
| `{{sponsor_exclusivity_or_restricted_orgs}}` | Any exclusivity/restricted organisations; requires review. |
| `{{sponsor_hosted_event_name_or_tbc}}` | Event hosted by sponsor for Velocity, if any. |
| `{{sponsor_invited_velocity_event_name_or_tbc}}` | Sponsor event Velocity members are invited to, if any. |
| `{{additional_benefits_to_student_group}}` | Additional student group benefits. |
| `{{early_termination_procedure}}` | Early termination process, if used. |
| `{{refund_circumstances}}` | Refund circumstances, if non-default. |

Important: Velocity must not sign sponsorship contracts. Sponsor signs first, then the contract is submitted to LSESU for review/signature.
