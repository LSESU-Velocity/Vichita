# LSESU Form Field Pack Template

Use this file as a copy-ready Markdown/Google Docs template for event submissions. It does **not** replace the official LSESU/Podio forms. It is a structured field pack for internal review before a committee member manually submits the current official form.

Standing note to include in generated packs:

> Draft aid only. LSESU's current published guidance and the live form are authoritative. Rules/templates were last manually verified on `{{rules_last_verified_date}}`. Re-check the current form before submission.

---

## Regular Event Form Field Pack

### Submission Metadata

- Form route: `Regular Event Form`
- Event classification: `{{event_classification}}`
- Classification reason: `{{classification_reason}}`
- Submission readiness: `{{submission_readiness_status}}`
- Generated on: `{{generated_at}}`
- Rules last verified: `{{rules_last_verified_date}}`

### Event Fields

| Official form field | Draft answer |
|---|---|
| What is the name of your event? | `{{event_name}}` |
| What type of group are you submitting on behalf of? | `Society` |
| What club/society are you submitting on behalf of? | `LSESU Velocity` |
| Name of Student Lead | `{{student_lead_name}}` |
| Committee Role | `{{student_lead_committee_role}}` |
| LSE Email Address | `{{student_lead_lse_email}}` |
| Date and time of activity, including setup time | `{{event_date_time_with_setup}}` |
| Is your activity repeated across multiple dates? | `{{is_repeated_event}}` |
| Repeated dates, if any | `{{repeated_event_dates}}` |
| Preferred event location | `{{preferred_event_location}}` |
| External venue details, if relevant | `{{external_venue_details}}` |
| Confirmation: no external speakers | `{{regular_event_no_external_speakers_confirmation}}` |
| Overview of the event | `{{event_overview}}` |
| Who will be attending? | `{{attendee_type}}` |
| Public/open academic chair note, if relevant | `{{public_event_academic_chair_note}}` |
| Approximate number of attendees | `{{expected_attendance}}` |
| Under-18s / vulnerable adults involved? | `{{under_18s_or_vulnerable_adults}}` |
| Film screening? | `{{film_screening_status}}` |
| Food or refreshments? | `{{food_refreshments_status}}` |
| Alcohol? | `{{alcohol_status}}` |
| Ticketing | `{{ticketing_plan}}` |
| Total event cost | `{{total_event_cost}}` |
| Risk Assessment attached? | `{{risk_assessment_attached_status}}` |
| Budget attached? | `{{budget_attached_status}}` |

### Attachment Checklist

- Risk Assessment: `{{risk_assessment_file_link}}`
- Budget, if required or useful: `{{budget_file_link}}`
- Accessibility checklist: `{{accessibility_checklist_link}}`
- Internal review summary: `{{internal_review_summary_link}}`

### Missing Information

{{#missing_fields}}
- `{{field_name}}` — owner: `{{owner}}`; affects: `{{affected_document}}`; deadline: `{{deadline}}`; why needed: `{{why_needed}}`
{{/missing_fields}}

---

## Large / Speaker Event Form Field Pack

### Submission Metadata

- Form route: `Large Event or Speaker Event Form`
- Event classification: `{{event_classification}}`
- Classification reason: `{{classification_reason}}`
- Submission readiness: `{{submission_readiness_status}}`
- Generated on: `{{generated_at}}`
- Rules last verified: `{{rules_last_verified_date}}`

### Core Event Fields

| Official form field | Draft answer |
|---|---|
| What is the name of your event? | `{{event_name}}` |
| What type of group are you submitting on behalf of? | `Society` |
| What club/society are you submitting on behalf of? | `LSESU Velocity` |
| Is this sports training or a match? | `No` |
| Name of Student Lead | `{{student_lead_name}}` |
| Committee Role | `{{student_lead_committee_role}}` |
| LSE Email Address | `{{student_lead_lse_email}}` |
| Provisional date and time, including setup time | `{{event_date_time_with_setup}}` |
| Preferred event location | `{{preferred_event_location}}` |
| Overview of the event | `{{event_overview}}` |
| Who will be attending? | `{{attendee_type}}` |
| Attendee registration / entry plan | `{{attendee_registration_entry_plan}}` |
| Approximate number of attendees | `{{expected_attendance}}` |
| Under-18s / schools / vulnerable adults / DBS details | `{{under_18s_schools_vulnerable_adults_dbs}}` |
| Film screening? | `{{film_screening_status}}` |
| Food or refreshments? | `{{food_refreshments_status}}` |
| Alcohol? | `{{alcohol_status}}` |
| SUF status | `{{suf_status}}` |
| Total event cost | `{{total_event_cost}}` |
| Contracts attached? | `{{contracts_attached_status}}` |
| Risk Assessment attached? | `{{risk_assessment_attached_status}}` |
| Budget attached? | `{{budget_attached_status}}` |

### External Speaker Fields

| Official form field | Draft answer |
|---|---|
| External speakers? | `{{external_speakers_status}}` |
| Full names, job titles, organisations, and descriptions of speakers | `{{external_speaker_details}}` |
| What topics will speakers be discussing? | `{{external_speaker_topics}}` |
| Academic Chair status | `{{academic_chair_status}}` |
| Academic Chair full name and email, if confirmed | `{{academic_chair_name_email}}` |
| Speaker approval status | `{{speaker_approval_status}}` |
| Promotion gate | `{{speaker_promotion_gate_status}}` |

### External Organisation / Sponsor Fields

| Official form field | Draft answer |
|---|---|
| External organisation involved? | `{{external_organisation_status}}` |
| Organisation name | `{{external_organisation_name}}` |
| How is the event society-led and fully organised by Velocity? | `{{society_led_explanation}}` |
| Sponsor / employer involvement details | `{{sponsor_employer_involvement_details}}` |
| LSE Careers contact required? | `{{lse_careers_contact_required}}` |
| Sponsorship contract status | `{{sponsorship_contract_status}}` |

### Missing Information

{{#missing_fields}}
- `{{field_name}}` — owner: `{{owner}}`; affects: `{{affected_document}}`; deadline: `{{deadline}}`; why needed: `{{why_needed}}`
{{/missing_fields}}
