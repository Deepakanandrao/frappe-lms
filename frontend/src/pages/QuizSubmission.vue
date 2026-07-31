<template>
	<header
		class="sticky top-0 z-10 flex items-center justify-between border-b bg-surface-base px-3 py-2.5 sm:px-5"
	>
		<Breadcrumbs v-if="submissionDetails.doc" :items="breadcrumbs" />
		<div class="flex gap-2 items-center">
			<Badge
				v-if="submissionDetails.isDirty"
				:label="__('Not Saved')"
				variant="subtle"
				theme="orange"
			/>
			<ShortcutTooltip :label="__('Save')" combo="Mod+S">
				<Button variant="solid" @click="saveSubmission()">
					{{ __('Save') }}
				</Button>
			</ShortcutTooltip>
		</div>
	</header>

	<div v-if="submissionDetails.doc" class="flex flex-col min-h-0 flex-1">

		<!-- Page title -->
		<div class="px-8 py-3 border-b">
			<h1 class="text-2xl font-semibold text-ink-gray-9">
				{{ submissionDetails.doc.quiz_title }}
			</h1>
		</div>

		<!-- Two-panel -->
		<div class="grid min-h-0 flex-1 grid-cols-[1fr_300px]">

			<!-- Left: Questions -->
			<div class="overflow-y-auto divide-y px-8">
				<div
					v-for="(row, index) in submissionDetails.doc.result"
					:key="row.name"
					class="py-6 grid grid-cols-[1fr_auto] gap-10 items-start"
				>
					<div class="space-y-3 min-w-0">
						<div class="flex items-start gap-2">
							<span class="text-xs font-semibold text-ink-gray-4 uppercase tracking-wide shrink-0 mt-0.5">{{ __('Q{0}:').format(index + 1) }}</span>
							<div class="flex items-start gap-2 min-w-0">
								<div
									class="text-sm text-ink-gray-9 leading-5"
									v-html="sanitizeRichHTML(row.question)"
								/>
								<span
									class="size-1.5 rounded-full shrink-0 mt-1.5"
									:class="row.marks == row.marks_out_of
										? 'bg-ink-green-5'
										: row.marks > 0
										? 'bg-ink-orange-5'
										: 'bg-ink-red-5'"
								/>
							</div>
						</div>
						<div class="space-y-1">
							<span class="text-xs font-medium text-ink-gray-4 uppercase tracking-wide">{{ __('Answer') }}</span>
							<div
								class="text-sm text-ink-gray-6 leading-5"
								v-html="sanitizeRichHTML(row.answer)"
							/>
						</div>
					</div>
					<div class="flex items-center gap-1.5 shrink-0">
						<FormControl
							v-if="isOpenEnded"
							v-model="row.marks"
							type="number"
							class="w-20"
						/>
						<span
							v-else
							class="w-20 text-right text-sm font-medium text-ink-gray-7"
						>{{ row.marks }}</span>
						<span class="text-sm text-ink-gray-5">/ {{ row.marks_out_of }}</span>
					</div>
				</div>
			</div>

			<!-- Right: Sidebar -->
			<div class="border-l overflow-y-auto">

				<!-- Member info -->
				<div class="p-5 space-y-3 border-b">
					<div class="flex items-center gap-3">
						<Avatar
							:image="memberImage"
							:label="submissionDetails.doc.member_name"
							size="2xl"
						/>
						<div>
							<div class="text-base text-ink-gray-8">
								{{ submissionDetails.doc.member_name }}
							</div>
							<div class="text-xs text-ink-gray-5 mt-0.5">
								{{ formatDate(submissionDetails.doc.creation) }}
							</div>
						</div>
					</div>
				</div>

				<!-- Score -->
				<div class="p-5 space-y-3 border-b">
					<div class="flex gap-6">
						<div>
							<div class="text-xs text-ink-gray-5 mb-0.5">{{ __('Score') }}</div>
							<div class="text-sm font-medium text-ink-gray-8">
								{{ submissionDetails.doc.score }} / {{ submissionDetails.doc.score_out_of }}
							</div>
						</div>
						<div>
							<div class="text-xs text-ink-gray-5 mb-0.5">{{ __('Percentage') }}</div>
							<div class="text-sm font-medium text-ink-gray-8">
								{{ submissionDetails.doc.percentage }}%
							</div>
						</div>
					</div>
					<div v-if="submissionDetails.doc.violation_count" class="flex flex-wrap gap-1.5">
						<span class="text-xs font-medium px-2 py-0.5 rounded-full bg-surface-red-2 text-ink-red-6">
							{{ submissionDetails.doc.violation_count }}
							{{ submissionDetails.doc.violation_count == 1 ? __('violation') : __('violations') }}
						</span>
					</div>
				</div>

				<!-- Proctoring activity -->
				<div v-if="violationLog.data?.length" class="p-5">
					<h2 class="text-sm font-semibold text-ink-gray-7 mb-3">
						{{ __('Proctoring Log') }}
						<span class="text-ink-gray-4 font-normal ml-1">({{ violationLog.data.length }})</span>
					</h2>
					<div class="space-y-3">
						<div
							v-for="(entry, i) in violationLog.data"
							:key="i"
							class="border-l-2 pl-3 py-0.5"
							:class="entry.severity === 'violation' ? 'border-ink-red-5' : 'border-ink-orange-4'"
						>
							<div class="text-xs font-medium text-ink-gray-7">
								{{ violationEventLabels[entry.event_type] || entry.event_type }}
							</div>
							<div class="flex items-center gap-1 mt-0.5">
								<span
									class="text-xs font-medium"
									:class="entry.severity === 'violation' ? 'text-ink-red-5' : 'text-ink-orange-5'"
								>{{ entry.severity }}</span>
								<span class="text-xs text-ink-gray-4">· {{ formatTime(entry.timestamp) }}</span>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	</div>
</template>

<script setup>
import { sanitizeRichHTML } from '@/utils/sanitizeRichHTML'
import {
	createDocumentResource,
	createResource,
	Breadcrumbs,
	FormControl,
	Button,
	Badge,
	Avatar,
	usePageMeta,
	toast,
} from 'frappe-ui'
import { computed, watch, onMounted, inject } from 'vue'
import ShortcutTooltip from '@/components/ShortcutTooltip.vue'
import {
	useKeyboardShortcuts,
	saveShortcut,
} from '@/composables/useKeyboardShortcuts'
import { useRouter } from 'vue-router'
import { sessionStore } from '@/stores/session'

const { brand } = sessionStore()
const router = useRouter()
const user = inject('$user')

onMounted(() => {
	if (!user.data?.is_instructor && !user.data?.is_moderator)
		router.push({ name: 'Courses' })
})

useKeyboardShortcuts({
	ignoreTyping: false,
	shortcuts: [
		{
			...saveShortcut(() => saveSubmission()),
			guard: (e) => !e.target?.classList?.contains('ProseMirror'),
		},
	],
})

const props = defineProps({
	submission: {
		type: String,
		required: true,
	},
})

const submissionDetails = createDocumentResource({
	doctype: 'LMS Quiz Submission',
	name: props.submission,
	auto: true,
})

const violationLog = createResource({
	url: 'lms.lms.doctype.lms_quiz.lms_quiz.get_quiz_violation_logs',
	makeParams() {
		return { submission: props.submission }
	},
	auto: true,
})

const openEndedCheck = createResource({
	url: 'lms.lms.doctype.lms_quiz.lms_quiz.is_open_ended_submission',
	makeParams() {
		return { submission: props.submission }
	},
	auto: true,
})

const isOpenEnded = computed(() => !!openEndedCheck.data)

const violationEventLabels = {
	tab_switch: __('Tab switched'),
	no_face: __('No face detected'),
	multiple_faces: __('Multiple faces'),
	focus_loss: __('Window focus lost'),
	camera_disconnect: __('Camera disconnected'),
}

const memberImageResource = createResource({
	url: 'frappe.client.get_value',
	makeParams() {
		return {
			doctype: 'User',
			filters: submissionDetails.doc?.member || '',
			fieldname: 'user_image',
		}
	},
	auto: false,
})

watch(
	() => submissionDetails.doc?.member,
	(member) => {
		if (member) memberImageResource.fetch()
	},
	{ immediate: true }
)

const memberImage = computed(() => memberImageResource.data?.user_image || '')

const submissionReasonLabel = computed(() => {
	const reasons = {
		timer_expired: __('Timer expired'),
		max_violations: __('Max violations'),
		browser_closed: __('Browser closed'),
	}
	return reasons[submissionDetails.doc?.submission_reason] ?? ''
})

const formatDate = (dateStr) => {
	if (!dateStr) return ''
	return new Date(dateStr).toLocaleDateString(undefined, {
		year: 'numeric', month: 'short', day: 'numeric',
	})
}

const formatTime = (datetimeStr) => {
	if (!datetimeStr) return ''
	return new Date(datetimeStr).toLocaleTimeString(undefined, {
		hour: '2-digit', minute: '2-digit', second: '2-digit',
	})
}

const breadcrumbs = computed(() => {
	if (!submissionDetails.doc) return []
	return [
		{
			label: __('Quiz Submissions'),
			route: {
				name: 'QuizSubmissionList',
				params: { quizID: submissionDetails.doc.quiz },
			},
		},
		{
			label: submissionDetails.doc.member_name || submissionDetails.doc.name,
		},
	]
})

const saveSubmission = () => {
	submissionDetails.save.submit(
		{},
		{
			onError(err) {
				toast.error(err.messages?.[0] || err)
			},
		}
	)
}

usePageMeta(() => ({
	title: `${submissionDetails.doc?.quiz_title}`,
	icon: brand.favicon,
}))
</script>
