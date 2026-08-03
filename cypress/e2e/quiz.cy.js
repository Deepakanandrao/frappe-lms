describe("Quiz", () => {
	let questionName, quizName, proctoredQuizName;

	before(() => {
		cy.login();

		// Create the LMS Question that both quizzes will share
		cy.request({
			url: "/api/method/frappe.client.insert",
			method: "POST",
			body: {
				doc: {
					doctype: "LMS Question",
					question: "What is 2 + 2?",
					type: "Choices",
					option_1: "3",
					option_2: "4",
					option_3: "5",
					option_4: "6",
					is_correct_2: 1,
				},
			},
		}).then(({ body }) => {
			questionName = body.message.name;

			// Plain multiple-choice quiz
			cy.request({
				url: "/api/method/frappe.client.insert",
				method: "POST",
				body: {
					doc: {
						doctype: "LMS Quiz",
						title: "Cypress Test Quiz",
						passing_percentage: 60,
						questions: [
							{
								doctype: "LMS Quiz Question",
								question: questionName,
								marks: 5,
							},
						],
					},
				},
			}).then(({ body }) => {
				quizName = body.message.name;
			});

			// Proctored quiz
			cy.request({
				url: "/api/method/frappe.client.insert",
				method: "POST",
				body: {
					doc: {
						doctype: "LMS Quiz",
						title: "Cypress Proctored Quiz",
						passing_percentage: 60,
						enable_proctoring: 1,
						max_violations: 3,
						questions: [
							{
								doctype: "LMS Quiz Question",
								question: questionName,
								marks: 5,
							},
						],
					},
				},
			}).then(({ body }) => {
				proctoredQuizName = body.message.name;
			});
		});
	});

	after(() => {
		cy.login();
		cy.request({
			url: "/api/method/frappe.client.delete",
			method: "POST",
			body: { doctype: "LMS Quiz", name: quizName },
			failOnStatusCode: false,
		});
		cy.request({
			url: "/api/method/frappe.client.delete",
			method: "POST",
			body: { doctype: "LMS Quiz", name: proctoredQuizName },
			failOnStatusCode: false,
		});
		cy.request({
			url: "/api/method/frappe.client.delete",
			method: "POST",
			body: { doctype: "LMS Question", name: questionName },
			failOnStatusCode: false,
		});
	});

	context("multiple choice quiz", () => {
		it("shows quiz info on the start screen", () => {
			cy.login();
			cy.visit(`/lms/quiz/${quizName}`);
			cy.closeOnboardingModal();

			cy.contains("Cypress Test Quiz").should("be.visible");
			cy.contains("1 question").should("be.visible");
			cy.contains("Passing score: 60%").should("be.visible");
		});

		it("starts the quiz and shows the question with answer choices", () => {
			cy.login();
			cy.visit(`/lms/quiz/${quizName}`);
			cy.closeOnboardingModal();

			cy.button("Start Quiz").should("not.be.disabled").click();

			cy.contains("What is 2 + 2?", { timeout: 10000 }).should(
				"be.visible"
			);
			cy.get('input[type="radio"]').should("have.length.greaterThan", 0);
		});

		it("submits the quiz and shows the result", () => {
			cy.login();
			cy.visit(`/lms/quiz/${quizName}`);
			cy.closeOnboardingModal();

			cy.button("Start Quiz").click();

			// Select any answer
			cy.get('input[type="radio"]', { timeout: 10000 })
				.first()
				.check({ force: true });

			cy.intercept(
				"POST",
				"**/api/method/lms.lms.doctype.lms_quiz.lms_quiz.submit_quiz"
			).as("submitQuiz");
			cy.button("Submit").click();
			cy.wait("@submitQuiz", { timeout: 15000 });

			// Result panel appears after submission
			cy.contains(/score|correct|result/i, { timeout: 10000 }).should(
				"exist"
			);
		});
	});

	context("proctored quiz", () => {
		it("shows Proctored badge and camera setup section on the start screen", () => {
			cy.login();
			cy.visit(`/lms/quiz/${proctoredQuizName}`);
			cy.closeOnboardingModal();

			cy.contains("Proctored").should("be.visible");
			cy.contains("Camera Setup").should("be.visible");
			cy.contains("Proctoring Rules").should("be.visible");
		});

		it("keeps Start Quiz disabled while camera access is not granted", () => {
			cy.login();
			cy.visit(`/lms/quiz/${proctoredQuizName}`);
			cy.closeOnboardingModal();

			cy.button("Start Quiz").should("be.disabled");
		});

		it("shows the max-violations auto-submit rule in the rules panel", () => {
			cy.login();
			cy.visit(`/lms/quiz/${proctoredQuizName}`);
			cy.closeOnboardingModal();

			cy.contains("After 3 violations").should("be.visible");
		});

		it("enables Start Quiz once camera access is granted", () => {
			cy.login();
			cy.visit(`/lms/quiz/${proctoredQuizName}`, {
				onBeforeLoad(win) {
					// Stub getUserMedia so the proctoring setup monitor gets a
					// stream without requiring a real camera in CI.
					const mockTrack = {
						addEventListener: () => {},
						stop: () => {},
					};
					const mockStream = {
						getVideoTracks: () => [mockTrack],
						getTracks: () => [mockTrack],
					};
					cy.stub(win.navigator.mediaDevices, "getUserMedia").resolves(
						mockStream
					);
				},
			});
			cy.closeOnboardingModal();

			// With camera available the monitor loads models; once a face is
			// detected (or the camera-ready path completes) the button enables.
			// In CI with a stubbed stream, camera-ready fires after model load.
			cy.button("Start Quiz", { timeout: 20000 }).should(
				"not.be.disabled"
			);
		});
	});
});
