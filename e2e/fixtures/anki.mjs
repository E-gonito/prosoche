/**
 * Fixtures for the Anki import: two decks in the shape of the author's own
 * exports under `Flashcards/`, header and all. One nests a folder down and
 * has an escaped line break and a `<pre>` block; the other has a Rust path,
 * which must not be read as the `::` separator once it is markdown.
 *
 * They are `.txt`, so nothing else in the app sees them until they are
 * imported into `Study/Flashcards/`.
 */

export default function () {
	return {
		'Flashcards/CS/Networking.txt': [
			'#separator:Tab',
			'#html:true',
			'#deck:CS::Networking',
			'#tags:CS Networking',
			'',
			'What is HTTP?\tHyper Text Transfer Protocol',
			'What does a GET look like?\tA request line&lt;br&gt;<pre>GET / HTTP/1.1<br>Host: example.com</pre>',
			''
		].join('\n'),

		'Flashcards/Wisdom.txt': [
			'#separator:Tab',
			'#html:true',
			'#deck:Wisdom',
			'#tags:Wisdom',
			'',
			'Where does stdin live in Rust?\tstd::io::stdin',
			''
		].join('\n')
	};
}
