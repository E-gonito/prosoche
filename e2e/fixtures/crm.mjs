/**
 * The Work CRM: the spec's own supplier, with notes and a history, and a lead
 * with neither, so the list has two kinds to filter between and an order to
 * keep. New contacts are made by the suite through the form.
 */
export default () => ({
	'Work/CRM/Mang Tomas Foods.md': `---
kind: supplier
company: Mang Tomas Foods
role: Sales
email: orders@mangtomas.ph
phone: +44 7700 900123
links:
  - https://mangtomas.ph
---

Pork and chicken supplier. Met at the trade fair.

## History
- 2026-09-29 Asked for a wholesale price list
- 2026-09-22 First call
`,
	'Work/CRM/Print Co.md': `---
kind: lead
company: Print Co
---

Menus, maybe.
`
});
