// English catalog — the SOURCE OF TRUTH. Every key the app can render is defined here; the other
// locales are Partial<typeof en> and fall back to these values on a miss. `as const` makes `keyof`
// a literal union, so a t() call naming a key absent here is a BUILD error, never a runtime blank.
//
// Naming: area.thing.state (flat, dotted; the whole dotted string is the key). Two server-facing
// namespaces: `err.<code>` for API error codes and `notice.<code>` for server-emitted notices — each
// MUST carry a remedy clause (say what to do next), which is the actual defect the envelope fixes.
//
// Keys arrive with their migration — do NOT pre-populate 830 keys. This is the phase-01 seed:
// the act-on tier (approve/connect/pay/retry/delete/confirm) plus the phase-02 code namespaces.
export const en = {
  // ---- common actions ----
  'common.confirm': 'Confirm',
  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'common.delete': 'Delete',
  'common.close': 'Close',
  'common.retry': 'Retry',
  'common.loading': 'Loading…',
  'common.approve': 'Approve',
  'common.reject': 'Reject',
  'common.connect': 'Connect',
  'common.reconnect': 'Reconnect',

  // ---- credits (money) ----
  'credits.exhausted': 'You are out of credits. Top up to keep running agents.',
  'credits.grant.confirm': 'This will cost about {credits} credits. Continue?',
  'credits.grant.title': 'Confirm credit spend',

  // ---- connection gate (blocking) ----
  'connect.required.title': 'Connection required',
  'connect.required.body': 'Connect {platforms} to continue. Your draft is ready and waiting.',

  // ---- approval (act-on) ----
  'approve.video.cost': 'Generating this video costs about {credits} credits. Approve?',
  'approve.send.confirm': 'Approve and send this email?',
  'approve.step.failed': 'A step failed. Review it, then retry or approve again.',

  // ---- schedule (F11 — was hardcoded English under a localized reply) ----
  'schedule.confirm_tail': "I've read the send time as {time}. Please confirm that's right.",

  // ---- destructive confirms (must keep naming the object) ----
  'confirm.delete.workspace': 'Delete workspace "{name}"? This cannot be undone.',
  'confirm.delete.generic': 'Delete "{name}"? This cannot be undone.',
  'confirm.lead.token.revoke': 'Revoke this intake link? Existing forms using it will stop working.',

  // ---- server error codes (err.<code>) — each carries a remedy ----
  'err.gmail_not_connected': 'Gmail is not connected. Connect Google to send email.',
  'err.invalid_grant': 'Your Google connection expired. Reconnect Google to keep sending.',
  'err.insufficient_credits': 'Not enough credits for this action. Top up and try again.',
  'err.gmail_send_failed': 'The email could not be sent. Check your Google connection and retry.',
  'err.no_recipient': 'No recipient was found for this email. Add a recipient and retry.',
  'err.network_error': 'Network problem — the request did not reach the server. Check your connection and retry.',
  'err.validation_failed': 'Some fields need fixing before this can be saved.',
  'err.invalid_ui_language': 'That interface language is not available yet.',
  // Fallback for an unrecognized code — the raw code still shows in small print (see t-error.ts).
  'err.generic': 'Something went wrong. Please try again.',

  // ---- server notices (notice.<code>) ----
  'notice.connect_to_publish': 'Connect {platforms} to publish — your draft is ready and waiting.',

  // ---- phase 03: act-on tier (workspace/scheduled/workflow/post/flow/publish/concept/plan) ----
  'autonomy.grant.notice': 'Autonomy granted — Atria will prepare and auto-publish on schedule.',
  'autonomy.grant.cta': '⚡ Prepare',
  'autonomy.grant.title.workspace': 'Grant Atria autonomy to run the steps and auto-publish on schedule',
  'autonomy.grant.title.post': 'Grant Atria autonomy to prepare and auto-publish on schedule',
  'autonomy.grant.title.brief': 'Grant Atria autonomy to prepare, then stop at review',
  'autonomy.grant.calculating': 'Calculating…',
  'autonomy.preparing.active': 'Atria is preparing the content and will auto-publish on the set schedule.',
  'autonomy.preparing.stalled': 'No automation progress yet — automation may be off. Click ▶ Execute to run manually.',
  'credits.grant.inline': '≈ {credits} cr?',

  'workspace.board.cta': '▦ Open board',
  'workspace.board.cta.title': 'Open full board (posts + DAG)',

  'schedule.cancel.notice': 'Scheduled send cancelled.',
  'schedule.reschedule.future_required': 'Pick a future time.',
  'schedule.reschedule.notice': 'Rescheduled.',
  'schedule.reschedule.cta': 'Reschedule',
  'schedule.optional.label': 'Schedule (optional)',
  'schedule.optional.help': 'Empty → publish now. A future time parks the post as scheduled; the scheduler publishes it automatically.',
  'post.scheduled_for': 'Scheduled for {time}',

  'workflow.executing.notice': 'Workflow executing…',
  'workflow.execute.starting': 'Starting…',
  'workflow.execute.continue': '▶ Continue (run stale steps)',
  'workflow.execute.rerun_flow_icon': '↻ Re-run flow',
  'workflow.execute.rerun_flow_plain': 'Re-run flow',
  'workflow.execute.check_connection': 'Check connection & run',
  'workflow.execute.cta': '▶ Execute',
  'workflow.resume.hint': 'A step was re-run — later steps are stale. Click Continue to regenerate them, then approve to publish.',
  'workflow.hint.planned': 'Ready to run — click Execute to generate this post step by step.',
  'workflow.hint.running': 'Running… watch each step light up below.',
  'workflow.hint.needs_approval': 'Paused before publishing — approve to post (dry-run by default).',
  'workflow.hint.needs_connection': 'Connect a platform before running.',
  'workflow.hint.completed': 'Completed. Click any step to review or re-run it.',
  'workflow.hint.failed': 'A step failed — fix and re-run, or re-run the flow.',
  'workflow.hint.scheduled': 'Scheduled — it will resume and run automatically at the confirmed time.',
  'workflow.hint.cancelled': 'Cancelled — the scheduled run was called off.',
  'workflow.hint.video_gate': 'Paused before video generation (the costly step) — review the script below, then approve.',
  'workflow.hint.concept_gate': 'Concept ready — pick the version you like (and optionally add a reference image), then Continue.',

  'step.rerun.notice': 'Re-running step — downstream steps marked stale',
  'step.rerun.cta': '↻ Re-run this step',
  'step.rerun.busy': 'Re-running…',
  'step.rerun.help': 'Regenerates this step. Later steps are marked stale — re-run them too before publishing.',

  'gate.external.review_approve': 'Paused before {agent} — an external action. Review where it can post, then approve.',
  'gate.external.approve_proceed': 'Paused before {agent} — an external action. Approve to proceed.',

  'video.approve.cta': '▶ Approve — generate video',
  'video.gate.review_hint': "Video generation is the costly step, so it waits for your OK. Not happy with the cut? Re-run the Video Script step first, then approve.",
  'video.gate.ready_hint': 'Ready to generate the video. This is the costly step, so it waits for your OK.',
  'video.approve.cost_note': 'Approving renders {shots} keyframes and {totalSec}s of video — roughly ${cost} of video generation, plus the images. Nothing has been generated yet.',

  'publish.publishing.notice': 'Publishing…',
  'publish.approve_schedule.cta': '📅 Approve + schedule',
  'publish.approve_agent.cta': 'Approve {agent}',
  'publish.safe_mode.blocked': 'Safe Simulation is on: publish is blocked to avoid accidental real social posts. Switch to Live for the one controlled demo.',
  'publish.row.will_publish': 'Will publish',
  'publish.row.asset_unsupported': "can't post this asset type",
  'publish.row.connection_state': 'connection {state}',
  'publish.review.load_failed': "Couldn't load publish review: {reason}",
  'publish.review.checking': 'Checking where this can publish…',
  'publish.review.title': 'Publish review · {assetType}',
  'publish.review.summary.some': '{publishable} of {total} platform(s) will receive this post.',
  'publish.review.summary.none': 'No platform can publish this post as-is — adjust the asset type or connect a platform.',

  'connect.platform.cta': 'Connect {platform}',
  'reconnect.platform.cta': 'Reconnect {platform}',
  'connect.continue.cta': "I've connected — continue",
  'connect.checking.busy': 'Checking…',
  'connect.manage.cta': '🔌 Manage Connections',
  'connect.fix.cta': '🔌 Fix connections',
  'connect.required.pre_run': 'This flow publishes on your behalf — connect the platform(s) below before it runs. Nothing has been generated yet, so no cost has been incurred.',
  'orchestrate.connect.required': 'Connect a platform before running — open the Connections tab, connect, then run again.',

  'flow.save.success': 'Flow "{name}" saved',
  'flow.rename.notice': 'Flow renamed',
  'flow.rename.saving': 'Saving…',
  'flow.rename.cta': 'Rename flow',
  'flow.rename.aria_label': 'Flow name',
  'flow.untitled': 'Untitled flow',
  'flow.executing.notice': 'Flow executing…',
  'flow.abort.notice': 'Flow aborted',
  'flow.abort.cta': '■ Abort',
  'flow.abort.busy': 'Aborting…',
  'flow.execute.cta': 'Execute flow',
  'flow.new_campaign.cta': '➕ New campaign from this flow',
  'confirm.abort.flow': 'Abort this flow? It stops at the next step boundary.',

  'concept.version.selected': 'Version {n} selected',
  'concept.version.label': 'Version {n}',
  'concept.upload.too_large': '"{name}" is over 8MB — use a smaller image.',
  'concept.upload.added_reference': 'Reference image added — the AI will follow it',
  'concept.upload.set_as_media': 'Image set as the post media',
  'concept.upload.removed': 'Reference image removed',
  'concept.upload.busy': 'Uploading…',
  'concept.upload.replace_cta': '↻ Replace image',
  'concept.upload.reference_cta': '🖼 Upload reference image',
  'concept.upload.own_cta': '🖼 Upload your image',
  'concept.upload.remove_cta': 'Remove',
  'concept.upload.help.media_step': 'Optional — the image/video step will generate FROM this reference. No upload = generated from text.',
  'concept.upload.help.no_media_step': 'Optional — use your own image as the post media instead of generating one.',
  'concept.gate.review_hint': 'Concept versions — the writer produced these; the highlighted one is active. Click another to switch before publishing.',
  'concept.gate.pick_hint': 'Concept ready — pick the version you like, optionally add a reference image, then Continue. Later steps (image/video, publish) use your choice.',
  'concept.gate.active_version': 'Active version: {version}. Switching updates the copy the later steps use (allowed until the post is published).',
  'concept.gate.continuing.busy': 'Continuing…',
  'concept.gate.continue_with.cta': '▶ Continue with Version {n}',

  'plan.tier.hint': 'Choose how much this flow should run — credits scale with agent count.',
  'plan.tier.agent_count.one': '{count} agent',
  'plan.tier.agent_count.other': '{count} agents',
  'plan.tier.credits': '≈ {credits} credits',
  'plan.tier.tokens': '≈ {tokens} tokens',

  'orchestrate.goal.required': 'Describe your goal first',
  'orchestrate.file.read_failed': 'Could not read that file',
  'strategist.run.failed': 'The strategist run failed — check Active Flows.',
  'strategist.run.finished': 'Strategist finished.',
  'strategist.run.still_drafting': 'Still drafting the calendar — you can open it in Active Flows.',

  'post.stage.brief': 'Draft brief — generate copy to continue',
  'post.stage.rework': 'Reworking — regenerate with feedback',
  'post.stage.review': 'Copy ready — awaiting your approval',
  'post.stage.ready_scheduled': 'Scheduled for {time} — Publisher will run',
  'post.stage.ready_now': 'Approved — Publisher runs on next scheduler tick',
  'post.stage.posting': 'Publisher running — posting now…',
  'post.stage.posted': 'Published{time}',
  'post.stage.partial': 'Partly published — some platforms failed',
  'post.stage.error': 'Publish failed — see error below',

  'confirm.delete.post': 'Delete this post?',
  'confirm.publish.live': 'Live publish this post to: {platforms}?',
  'post.delete.notice': 'Post deleted',
  'post.edit_brief.cta': 'Edit brief',
  'post.generate.cta': 'Generate copy',
  'post.approve_schedule.cta': 'Approve / schedule',
  'post.refine.cta': 'Refine',
  'post.reject_rework.cta': 'Reject + rework',
  'post.publish_live_only.cta': 'Publish (Live only)',
  'post.publish_now.cta': 'Publish now',
  'post.publish.title.safe': 'Publishing is disabled in Safe Simulation — switch to Live to post now. Scheduled posts publish automatically at their time.',
  'post.publish.title.live': 'Publishes to real social platforms immediately, bypassing any schedule',
  'post.reject.label': 'Rework feedback',
  'post.reject.placeholder': 'What to change: tone, hook, CTA, length, language…',
  'post.reject.send.cta': 'Send feedback',
  'post.schedule.label': 'Approve schedule',
  'post.schedule.help': 'Empty means ready immediately. Scheduler publishes ready posts whose time is due.',
  'post.approve_final.cta': 'Approve final',
  'post.refine.label': 'Refine copy (targeted edit)',
  'post.refine.placeholder': 'e.g. shorten the hook, add a discount mention, make the tone warmer…',
  'post.refine.help': 'Applies a small change via AI (keeps audit trail). Result returns to review for re-approval.',
  'post.refine.apply.cta': 'Apply refinement',
  'post.refine.busy': 'Refining…',
} as const;

export type Catalog = typeof en;
export type MessageKey = keyof Catalog;
