/**
 * The one inbox, `Inbox/Capture.md`, as `capture.ts` writes it: a day
 * heading per day, bare captures stamped with the time, a task kept as a
 * task, and one line already dealt with. One capture carries the Work
 * workspace's tag, so its Inbox tab has a line of its own.
 */

function shiftDay(day, offset) {
	const [y, m, d] = day.split('-').map(Number);
	const date = new Date(y, m - 1, d + offset);
	const pad = (n) => String(n).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export default function inbox({ TODAY }) {
	return {
		'Inbox/Capture.md': [
			'# Capture',
			'',
			`## ${shiftDay(TODAY, -2)}`,
			'- 08:10 Renew the passport',
			'- [x] 08:20 Already dealt with',
			'',
			`## ${TODAY}`,
			'- 09:05 Call the printer #ws/work',
			'- [ ] Buy stamps `Q3`',
			'- 09:30 Look into a standing desk',
			''
		].join('\n')
	};
}
