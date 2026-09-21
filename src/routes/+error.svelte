<script lang="ts">
	import { page } from '$app/state';
</script>

<div class="fail">
	<h1>{page.status}</h1>
	<p>{page.error?.message ?? 'Something went wrong.'}</p>
	<p class="back"><a href="/">Back to today</a></p>
</div>

<style>
	.fail { max-width: 460px; margin: 64px auto; text-align: center; }
	h1 { margin: 0; font-size: 44px; color: var(--muted); }
	p { color: var(--text); }
	.back { margin-top: 20px; }
	a { color: var(--accent); }
</style>
