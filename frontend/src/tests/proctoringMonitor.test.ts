/**
 * ProctoringMonitor.vue — camera gate and violation event emission.
 *
 * Covers: loading state, camera denied, monitoring pill display,
 * tab-switch violation, and camera-disconnect violation.
 *
 * face-api.js is fully mocked so no actual model loading or GPU usage occurs.
 * navigator.mediaDevices.getUserMedia is stubbed per test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ProctoringMonitor from '@/components/ProctoringMonitor.vue'

// ─── face-api.js mock ─────────────────────────────────────────────────────────

// vi.mock is hoisted to the top of the file, so any variables it references
// must also be hoisted via vi.hoisted() to be initialised in time.
const { detectAllFacesMock } = vi.hoisted(() => ({
	detectAllFacesMock: vi.fn().mockResolvedValue([]),
}))

vi.mock('face-api.js', () => ({
	nets: {
		tinyFaceDetector: {
			loadFromUri: vi.fn().mockResolvedValue(undefined),
		},
	},
	detectAllFaces: detectAllFacesMock,
	TinyFaceDetectorOptions: vi.fn(),
}))

vi.stubGlobal('__', (s: string) => s)

// ─── Camera / stream helpers ──────────────────────────────────────────────────

// Captured by the mock so tests can trigger camera disconnect manually
let trackEndedHandler: (() => void) | null = null

const makeMockStream = () => {
	trackEndedHandler = null
	const track = {
		addEventListener: vi.fn((event: string, cb: () => void) => {
			if (event === 'ended') trackEndedHandler = cb
		}),
		stop: vi.fn(),
	}
	return {
		getVideoTracks: vi.fn(() => [track]),
		getTracks: vi.fn(() => [track]),
	}
}

let getUserMediaMock: ReturnType<typeof vi.fn>

beforeEach(() => {
	trackEndedHandler = null
	detectAllFacesMock.mockResolvedValue([])
	getUserMediaMock = vi.fn().mockResolvedValue(makeMockStream())
	Object.defineProperty(global, 'navigator', {
		value: { mediaDevices: { getUserMedia: getUserMediaMock } },
		writable: true,
		configurable: true,
	})
	Object.defineProperty(document, 'visibilityState', {
		value: 'visible',
		writable: true,
		configurable: true,
	})
})

afterEach(() => {
	vi.clearAllMocks()
})

// ─── Mount helper ─────────────────────────────────────────────────────────────

const mountMonitor = (props: Partial<{ active: boolean; violationCount: number }> = {}) =>
	mount(ProctoringMonitor, {
		props: { maxViolations: 3, active: false, violationCount: 0, ...props },
		global: { mocks: { __: (s: string) => s } },
		attachTo: document.body,
	})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ProctoringMonitor — setup phase', () => {
	it('shows the loading label while camera initialises', () => {
		// Before getUserMedia resolves, setupStatus is 'loading'
		const wrapper = mountMonitor()
		expect(wrapper.text()).toContain('Loading camera')
	})

	it('shows an error message and emits camera-denied when access is refused', async () => {
		getUserMediaMock.mockRejectedValue(new Error('NotAllowedError'))
		const wrapper = mountMonitor()
		await flushPromises()
		expect(wrapper.text()).toContain('Camera access was denied')
		expect(wrapper.emitted('camera-denied')).toBeTruthy()
	})

	it('shows "Position your face" label after camera loads', async () => {
		const wrapper = mountMonitor()
		await flushPromises()
		// Models loaded, interval started — setupStatus transitions to 'detecting'
		expect(wrapper.text()).toContain('Position your face')
	})

})

describe('ProctoringMonitor — monitoring phase', () => {
	it('shows the violation count pill', async () => {
		const wrapper = mountMonitor({ active: true, violationCount: 2 })
		await flushPromises()
		expect(wrapper.text()).toContain('2 / 3')
		expect(wrapper.text()).toContain('violations')
	})

	it('pill is red when violation count is greater than zero', async () => {
		const wrapper = mountMonitor({ active: true, violationCount: 1 })
		await flushPromises()
		const pill = wrapper.find('.rounded-full')
		expect(pill.classes().join(' ')).toContain('bg-surface-red-1')
	})

	it('pill is green when there are no violations', async () => {
		const wrapper = mountMonitor({ active: true, violationCount: 0 })
		await flushPromises()
		const pill = wrapper.find('.rounded-full')
		expect(pill.classes().join(' ')).toContain('bg-surface-green-1')
	})

	it('emits violation("tab_switch") when the document becomes hidden', async () => {
		const wrapper = mountMonitor({ active: true })
		await flushPromises()

		Object.defineProperty(document, 'visibilityState', {
			value: 'hidden',
			writable: true,
			configurable: true,
		})
		document.dispatchEvent(new Event('visibilitychange'))

		expect(wrapper.emitted('violation')).toContainEqual(['tab_switch'])
	})

	it('emits violation("camera_disconnect") when the video track ends', async () => {
		const wrapper = mountMonitor({ active: true })
		await flushPromises()

		expect(trackEndedHandler).not.toBeNull()
		trackEndedHandler!()

		expect(wrapper.emitted('violation')).toContainEqual(['camera_disconnect'])
	})
})
