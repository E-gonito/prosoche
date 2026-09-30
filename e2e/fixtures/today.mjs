/**
 * Extra fixture data for the Today dashboard: a workspace task overdue since
 * long before any run of this suite, and a future daily note for Next day to
 * open.
 */

function shiftDay(day, offset) {
	const [y, m, d] = day.split('-').map(Number);
	const date = new Date(y, m - 1, d + offset);
	const pad = (n) => String(n).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export default function today({ TODAY }) {
	const future = shiftDay(TODAY, 2);
	const [fy, fm, fd] = future.split('-');

	return {
		// Claimed by the `work` workspace through its folder, the same way
		// `Work/Handbook.md` already is. Long overdue, so the suite never has
		// to chase a date that will one day stop being in the past.
		'Work/Billing.md': '# Billing\n\n- [ ] Chase the overdue invoice `Q1` 📅 2000-01-01\n',
		[`Journal/${fy}/${fm}/${fd}.md`]: '# Tasks\n- [ ] Prep the demo for Thursday `Q1`\n'
	};
}
