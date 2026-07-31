<template>
	<LayoutHeader>
		<template #left-header>
			<Breadcrumbs :items="breadcrumbs" />
		</template>
	</LayoutHeader>

	<div class="flex min-h-0 flex-1 flex-col pt-5">
		<div class="mx-5 mb-5 flex flex-col justify-between gap-y-4 sm:flex-row sm:items-center">
			<h1 class="text-lg-semibold text-ink-gray-9">
				{{ __('Submissions for {0} Quiz').format(quizTitle || '…') }}
			</h1>
			<FormControl
				v-model="search"
				type="text"
				:placeholder="__('Search')"
				:aria-label="__('Search')"
			>
				<template #prefix>
					<span class="lucide-search size-4 text-ink-gray-5" />
				</template>
			</FormControl>
		</div>

		<div
			v-if="submissions.loading && !submissions.data"
			class="flex flex-1 items-center justify-center px-5"
		>
			<LoadingIndicator class="size-5 text-ink-gray-5" />
		</div>
		<ListView
			v-else-if="submissions.data?.length"
			:columns="columns"
			:rows="submissions.data"
			row-key="name"
			:options="{ showTooltip: false, selectable: true }"
			class="flex-1 overflow-y-auto px-5"
		>
			<ListHeader class="mb-2 grid items-center rounded bg-surface-gray-2 p-2">
				<ListHeaderItem :item="item" v-for="item in columns" :key="item.key">
					<template #prefix="{ item }">
						<span :class="[item.icon, 'h-4 w-4']" aria-hidden="true" />
					</template>
				</ListHeaderItem>
			</ListHeader>
			<ListRows>
				<router-link
					v-for="row in submissions.data"
					:key="row.name"
					:to="{ name: 'QuizSubmission', params: { submission: row.name } }"
				>
					<ListRow :row="row" class="hover:bg-surface-gray-2">
						<template #default="{ column, item }">
							<ListRowItem :item="row[column.key]" :align="column.align">
								<div v-if="column.key === 'score'" class="text-sm text-ink-gray-7">
									{{ row.score }} / {{ row.score_out_of }}
								</div>
								<div v-else-if="column.key === 'percentage'" class="text-sm text-ink-gray-7">
									{{ row.percentage }}%
								</div>
								<div v-else-if="column.key === 'submission_reason'">
									<span
										v-if="row.submission_reason && row.submission_reason !== 'manual'"
										class="text-xs font-medium px-2 py-0.5 rounded-full"
										:class="row.submission_reason === 'max_violations'
											? 'bg-surface-red-2 text-ink-red-6'
											: 'bg-surface-orange-2 text-ink-orange-6'"
									>
										{{ submissionReasonLabel(row.submission_reason) }}
									</span>
									<span v-else class="text-sm text-ink-gray-4">{{ __('Manual') }}</span>
								</div>
								<div v-else-if="column.key === 'violation_count'" class="text-sm">
									<span v-if="row.violation_count" class="text-ink-red-6 font-medium">
										{{ row.violation_count }}
									</span>
									<span v-else class="text-ink-gray-4">0</span>
								</div>
								<div v-else-if="column.key === 'creation'" class="text-sm text-ink-gray-5">
									{{ row.creation }}
								</div>
								<div v-else class="text-sm text-ink-gray-7">{{ item }}</div>
							</ListRowItem>
						</template>
					</ListRow>
				</router-link>
			</ListRows>
			<ListSelectBanner>
				<template #actions="{ unselectAll, selections }">
					<div class="flex gap-2">
						<Button
							variant="ghost"
							:label="__('Delete')"
							@click="deleteSubmissions(selections, unselectAll)"
						>
							<span class="lucide-trash-2 size-4" />
						</Button>
					</div>
				</template>
			</ListSelectBanner>
		</ListView>
		<div v-else class="flex-1">
			<EmptyStateLayout name="Quiz Submissions" icon="lucide-file-check" />
		</div>

		<ListFooter
			v-model="pageLength"
			class="border-t px-3 py-2 sm:px-5"
			:options="{
				rowCount: submissions.data?.length,
				totalCount: totalSubmissions.data,
			}"
		>
			<template #right>
				<div class="flex items-center">
					<Button
						v-if="submissions.hasNextPage"
						:label="__('Load More')"
						@click="submissions.next()"
					/>
					<div v-if="submissions.hasNextPage" class="mx-3 h-[80%] border-l" />
					<div class="flex items-center gap-1 text-base text-ink-gray-5">
						<div>{{ submissions.data?.length || 0 }}</div>
						<div>{{ __('of') }}</div>
						<div>{{ totalSubmissions.data || 0 }}</div>
					</div>
				</div>
			</template>
		</ListFooter>
	</div>
</template>

<script setup>
import {
	createListResource,
	createResource,
	Breadcrumbs,
	Button,
	FormControl,
	ListView,
	ListRow,
	ListRows,
	ListHeader,
	ListHeaderItem,
	ListRowItem,
	ListFooter,
	ListSelectBanner,
	LoadingIndicator,
	toast,
	usePageMeta,
} from 'frappe-ui'
import { computed, inject, onMounted, ref, watch } from 'vue'
import { sessionStore } from '../stores/session'
import { useRouter } from 'vue-router'
import EmptyStateLayout from '@/components/Layouts/EmptyStateLayout.vue'
import LayoutHeader from '@/components/Layouts/LayoutHeader.vue'

const { brand } = sessionStore()
const router = useRouter()
const user = inject('$user')
const dayjs = inject('$dayjs')
const search = ref('')

const props = defineProps({
	quizID: {
		type: String,
		required: true,
	},
})

onMounted(() => {
	if (!user.data?.is_instructor && !user.data?.is_moderator)
		router.push({ name: 'Courses' })
})

const submissionFilters = ref({ quiz: props.quizID })

watch(search, () => {
	submissionFilters.value = {
		quiz: props.quizID,
		member_name: ['like', `%${search.value}%`],
	}
	submissions.update({ filters: submissionFilters.value })
	submissions.reload()
	totalSubmissions.update({ params: { doctype: 'LMS Quiz Submission', filters: submissionFilters.value } })
	totalSubmissions.reload()
})

const submissions = createListResource({
	doctype: 'LMS Quiz Submission',
	filters: submissionFilters,
	fields: [
		'name',
		'member_name',
		'score',
		'score_out_of',
		'percentage',
		'creation',
		'quiz_title',
	],
	orderBy: 'creation desc',
	auto: true,
	transform(data) {
		return data.map((row) => ({
			...row,
			creation: dayjs(row.creation).format('DD MMM YYYY'),
		}))
	},
})

const pageLength = computed({
	get: () => submissions.pageLength,
	set: (value) => {
		submissions.update({ pageLength: value })
		submissions.reload()
	},
})

const totalSubmissions = createResource({
	url: 'frappe.client.get_count',
	params: {
		doctype: 'LMS Quiz Submission',
		filters: submissionFilters.value,
	},
	auto: true,
})

const submissionReasonLabel = (reason) => {
	const map = {
		timer_expired: __('Timer expired'),
		max_violations: __('Max violations'),
		browser_closed: __('Browser closed'),
	}
	return map[reason] ?? reason
}

const deleteSubmissions = (selections, unselectAll) => {
	Array.from(selections).forEach(async (name) => {
		await submissions.delete.submit(name)
	})
	unselectAll()
	totalSubmissions.reload()
	toast.success(__('Submissions deleted successfully'))
}

const quizTitle = computed(() => submissions.data?.[0]?.quiz_title)

const columns = computed(() => [
	{
		label: __('Member'),
		key: 'member_name',
		width: 2,
		icon: 'lucide-user',
	},
	{
		label: __('Score'),
		key: 'score',
		width: 1,
		align: 'center',
		icon: 'lucide-hash',
	},
	{
		label: __('Percentage'),
		key: 'percentage',
		width: 0.75,
		align: 'center',
		icon: 'lucide-percent',
	},
	{
		label: __('Submitted On'),
		key: 'creation',
		width: 1,
		align: 'right',
		icon: 'lucide-clock',
	},
])

const breadcrumbs = computed(() => {
	const crumbs = [
		{ label: __('Quizzes'), route: { name: 'Quizzes' } },
	]
	if (quizTitle.value) {
		crumbs.push({
			label: quizTitle.value,
			route: { name: 'QuizForm', params: { quizID: props.quizID } },
		})
	}
	crumbs.push({ label: __('Submissions') })
	return crumbs
})

usePageMeta(() => ({
	title: __('Quiz Submissions'),
	icon: brand.favicon,
}))
</script>
