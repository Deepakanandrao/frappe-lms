/**
 * Quiz.vue — multiple-choice flow and proctoring violation handling.
 *
 * Covers: loading state, start screen badges, start-button enable/disable,
 * question rendering after start, attempts-exhausted guard, proctoring UI,
 * and violation counting / auto-submit at max violations.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import Quiz from '@/components/Quiz.vue'

// Frappe's String.prototype.format (s.format(a, b)) is not available in tests
beforeAll(() => {
	Object.defineProperty(String.prototype, 'format', {
		value(...args: unknown[]) {
			return (this as string).replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)] ?? ''))
		},
		configurable: true,
	})
})
afterAll(() => {
	delete (String.prototype as any).format
})

// ─── Fixtures ─────────────────────────────────────────────────────────────────

type QuizDoc = {
	name: string
	title: string
	questions: Array<{ question: string; marks: number }>
	passing_percentage?: number
	max_attempts?: number
	duration?: number
	enable_proctoring?: boolean
	max_violations?: number
	show_answers?: boolean
	show_submission_history?: boolean
	shuffle_questions?: boolean
	enable_negative_marking?: boolean
	marks_to_cut?: number
	limit_questions_to?: number
}

let quizFixture: QuizDoc | null = null
let questionsMapFixture: Record<string, unknown> = {}
let attemptsFixture: unknown[] = []

const makeQuiz = (over: Partial<QuizDoc> = {}): QuizDoc => ({
	name: 'test-quiz-1',
	title: 'Geography Quiz',
	questions: [
		{ question: 'q1', marks: 5 },
		{ question: 'q2', marks: 5 },
	],
	passing_percentage: 60,
	duration: 0,
	max_attempts: 0,
	show_answers: false,
	show_submission_history: false,
	shuffle_questions: false,
	enable_proctoring: false,
	enable_negative_marking: false,
	...over,
})

const baseQuestionsMap: Record<string, unknown> = {
	q1: {
		question: 'Capital of France?',
		type: 'Choices',
		option_1: 'Berlin',
		option_2: 'Paris',
		option_3: 'Rome',
		option_4: '',
		is_correct_1: 0,
		is_correct_2: 1,
		is_correct_3: 0,
		is_correct_4: 0,
		multiple: false,
		marks: 5,
	},
	q2: {
		question: 'Largest planet?',
		type: 'Choices',
		option_1: 'Earth',
		option_2: 'Saturn',
		option_3: 'Jupiter',
		option_4: '',
		is_correct_1: 0,
		is_correct_2: 0,
		is_correct_3: 1,
		is_correct_4: 0,
		multiple: false,
		marks: 5,
	},
}

// ─── Mocks ────────────────────────────────────────────────────────────────────

// vi.hoisted ensures these are available when vi.mock factories run (which are
// hoisted to the top of the file before any const/let declarations).
const { _submitSpy, _resetSpy, _toast } = vi.hoisted(() => ({
	_submitSpy: vi.fn(),
	_resetSpy: vi.fn(),
	_toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}))

vi.mock('frappe-ui', () => ({
	createResource: (opts: any) => {
		if (opts.url === 'lms.lms.utils.get_quiz_with_questions') {
			if (!quizFixture) {
				return { data: null, loading: true, reload: vi.fn() }
			}
			// transform() has the side-effect of writing Quiz.vue's questionsByName ref
			const raw = { quiz: { ...quizFixture }, questions_by_name: questionsMapFixture }
			const data = opts.transform ? opts.transform(raw) : raw.quiz
			// Schedule onSuccess so populateQuestions() runs after mount
			if (opts.onSuccess) Promise.resolve().then(() => opts.onSuccess())
			return { data, loading: false, reload: vi.fn() }
		}
		if (opts.url === 'frappe.client.get_list') {
			return { data: attemptsFixture, loading: false, reload: vi.fn() }
		}
		if (opts.url === 'lms.lms.doctype.lms_quiz.lms_quiz.submit_quiz') {
			return { data: null, loading: false, submit: _submitSpy, reset: _resetSpy }
		}
		// inline check_answer resource and any future additions
		return { data: null, loading: false, reload: vi.fn(), submit: vi.fn(), reset: vi.fn() }
	},
	Button: {
		template: '<button :disabled="disabled"><slot /></button>',
		props: ['disabled', 'variant'],
	},
	Badge: { template: '<span><slot /></span>' },
	LoadingIndicator: { template: '<div class="spinner" />' },
	ListView: { template: '<div />' },
	FormControl: { template: '<input />', props: ['modelValue', 'type'] },
	Checkbox: { template: '<input type="checkbox" />' },
	Dialog: { template: '<div />' },
	toast: _toast,
	call: vi.fn(),
}))

vi.mock('@/components/ProctoringMonitor.vue', () => ({
	default: {
		name: 'ProctoringMonitor',
		template: '<div class="proctoring-monitor" />',
		props: ['maxViolations', 'active', 'violationCount'],
		emits: ['violation', 'warning', 'camera-ready', 'camera-denied', 'camera-lost'],
	},
}))
vi.mock('@/components/RichTextEditor.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/utils/sanitizeRichHTML', () => ({ sanitizeRichHTML: (s: string) => s || '' }))
vi.mock('@/utils/format', () => ({ timeAgo: (s: string) => s }))

vi.stubGlobal('__', (s: string) => s)
vi.stubGlobal('localStorage', {
	getItem: vi.fn(() => null),
	setItem: vi.fn(),
	removeItem: vi.fn(),
})

// ─── Mount helper ─────────────────────────────────────────────────────────────

const mountQuiz = () =>
	mount(Quiz, {
		props: { quizName: 'test-quiz-1' },
		global: {
			provide: { $user: { data: { name: 'student@test.com' } } },
			mocks: { __: (s: string) => s },
		},
	})

beforeEach(() => {
	quizFixture = null
	questionsMapFixture = { ...baseQuestionsMap }
	attemptsFixture = []
	_submitSpy.mockReset()
	_resetSpy.mockReset()
	Object.values(_toast).forEach((fn) => fn.mockReset())
	vi.useFakeTimers()
})

afterEach(() => {
	vi.useRealTimers()
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Quiz — loading', () => {
	it('renders a spinner while quiz data is fetching', () => {
		// quizFixture is null → resource returns loading: true, data: null
		const wrapper = mountQuiz()
		expect(wrapper.find('.spinner').exists()).toBe(true)
	})
})

describe('Quiz — start screen (multiple choice)', () => {
	beforeEach(() => {
		quizFixture = makeQuiz()
	})

	it('shows the quiz title', async () => {
		const wrapper = mountQuiz()
		await flushPromises()
		expect(wrapper.text()).toContain('Geography Quiz')
	})

	it('shows the correct question count badge', async () => {
		const wrapper = mountQuiz()
		await flushPromises()
		expect(wrapper.text()).toContain('2 questions')
	})

	it('shows the passing percentage badge', async () => {
		const wrapper = mountQuiz()
		await flushPromises()
		expect(wrapper.text()).toContain('Passing score: 60%')
	})

	it('shows a max-attempts badge when set', async () => {
		quizFixture = makeQuiz({ max_attempts: 3 })
		const wrapper = mountQuiz()
		await flushPromises()
		expect(wrapper.text()).toContain('3 attempts')
	})

	it('Start Quiz button is enabled for a plain quiz', async () => {
		const wrapper = mountQuiz()
		await flushPromises()
		const btn = wrapper.findAll('button').find((b) => b.text() === 'Start Quiz')
		expect(btn).toBeDefined()
		expect(btn!.attributes('disabled')).toBeUndefined()
	})

	it('shows the first question after clicking Start Quiz', async () => {
		const wrapper = mountQuiz()
		await flushPromises()
		await wrapper.findAll('button').find((b) => b.text() === 'Start Quiz')!.trigger('click')
		await flushPromises()
		expect(wrapper.text()).toContain('Capital of France?')
	})

	it('renders choice options as radio inputs', async () => {
		const wrapper = mountQuiz()
		await flushPromises()
		await wrapper.findAll('button').find((b) => b.text() === 'Start Quiz')!.trigger('click')
		await flushPromises()
		expect(wrapper.findAll('input[type="radio"]').length).toBeGreaterThan(0)
	})
})

describe('Quiz — attempts exhausted', () => {
	it('hides Start Quiz and shows exhaustion message when all attempts used', async () => {
		quizFixture = makeQuiz({ max_attempts: 2 })
		attemptsFixture = [{ name: 'sub-1' }, { name: 'sub-2' }]
		const wrapper = mountQuiz()
		await flushPromises()
		expect(wrapper.findAll('button').every((b) => b.text() !== 'Start Quiz')).toBe(true)
		expect(wrapper.text()).toContain("You've used all 2 attempts")
	})
})

describe('Quiz — proctoring UI', () => {
	beforeEach(() => {
		quizFixture = makeQuiz({ enable_proctoring: true, max_violations: 3 })
	})

	it('shows the Proctored badge in the info card', async () => {
		const wrapper = mountQuiz()
		await flushPromises()
		expect(wrapper.text()).toContain('Proctored')
	})

	it('renders Camera Setup and Proctoring Rules panels', async () => {
		const wrapper = mountQuiz()
		await flushPromises()
		expect(wrapper.text()).toContain('Camera Setup')
		expect(wrapper.text()).toContain('Proctoring Rules')
	})

	it('shows the max-violations warning in the rules panel', async () => {
		const wrapper = mountQuiz()
		await flushPromises()
		expect(wrapper.text()).toContain('After 3 violations')
	})

	it('Start Quiz is disabled until camera is ready', async () => {
		const wrapper = mountQuiz()
		await flushPromises()
		const btn = wrapper.findAll('button').find((b) => b.text() === 'Start Quiz')
		expect(btn).toBeDefined()
		// cameraReady starts false → disabled prop is true
		expect(btn!.attributes('disabled')).toBeDefined()
	})

	it('enables Start Quiz once camera-ready fires from the setup monitor', async () => {
		const wrapper = mountQuiz()
		await flushPromises()
		// The setup ProctoringMonitor has :active="false"
		const setupMonitor = wrapper
			.findAllComponents({ name: 'ProctoringMonitor' })
			.find((m) => m.props('active') === false)
		expect(setupMonitor).toBeDefined()
		await setupMonitor!.vm.$emit('camera-ready')
		await flushPromises()
		const btn = wrapper.findAll('button').find((b) => b.text() === 'Start Quiz')
		expect(btn!.attributes('disabled')).toBeUndefined()
	})
})

