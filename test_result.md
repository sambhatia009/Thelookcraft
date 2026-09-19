#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================

user_problem_statement: 'Lookbook Try-On: Add "Visualise on me" to saved looks and include the render in the share card. Also let users save visualised Stylist looks in Lookbook.'
backend:
  - task: "Persist try-on on saved looks and validate ownership/item match"
    implemented: true
    working: true
    file: backend/server.py
    stuck_count: 0
    priority: high
    needs_retesting: false
    status_history:
      - working: NA
        agent: main
        comment: "Added optional visualization_path on outfit create/patch/list, Pydantic response models, POST /api/outfits/{id}/visualize reuses real Gemini/storage and persists. Validation rejects foreign or mismatched paths and invalid pieces; profile-photo-scoped cache. Saved images survive profile-photo changes."
      - working: true
        agent: testing
        comment: "Iteration 7 backend 9/9 PASS, real AI/storage, persistence and validation confirmed."
frontend:
  - task: "Lookbook try-on, loaded render in share/save card"
    implemented: true
    working: true
    file: frontend/app/(tabs)/lookbook.tsx
    stuck_count: 0
    priority: high
    needs_retesting: false
    status_history:
      - working: NA
        agent: main
        comment: "Added visualize button, automatic persistence, loading/retry/missing-photo Profile CTA; shared uncropped TryOnPreview is inside capture ref; share/save blocked while generating/loading. Existing no-image layout retained. Empty screen smoke PASS on 390x844."
      - working: true
        agent: main
        comment: "Iteration 8 + final follow-up PASS: exported PNG visually inspected, image retry works, no runtime loop/crash, normal older-image reads 3/3. Non-render Share/Save/tag/wear/delete full regression PASS. Native device share/Photos follow-up remains."
  - task: "Save visualised Stylist result into Lookbook"
    implemented: true
    working: true
    file: frontend/app/(tabs)/stylist.tsx
    stuck_count: 0
    priority: high
    needs_retesting: false
    status_history:
      - working: NA
        agent: main
        comment: "Save Try-On creates outfit including path. Save-before-visualise uses savedOutfitId to update same look without duplicate. Edits clear stale render and save link; loading locks edits and save."
      - working: true
        agent: testing
        comment: "Iteration 8: visualise-first and save-first passed, same saved ID for updates, occasion preserved, editing clears old try-on/save state."
metadata:
  created_by: main
  version: "1.0"
  test_sequence: 8
  run_ui: true
test_plan:
  current_focus:
    - "Real Lookbook try-on and persistence after re-login"
    - "Stylist visualise-before-save and save-before-visualise"
    - "Share/Save downloaded image actually contains render, title and watermark"
    - "No-photo, failure/retry, invalid/foreign render, deleted outfits, edit invalidation"
    - "Existing tags, wear, delete and no-render card regression"
  stuck_tasks: []
  test_all: false
  test_priority: high_first
agent_communication:
  - agent: main
    message: "Read memory/test_credentials.md: lookbook.tryon.qa@example.com / pass1234 is CREATED and screenshot verified. Legacy demo login failed; do not use it. Use this dedicated account or document any new ones. No integrations mocked; real Gemini and private storage. Python/edited screen lints pass. Existing unrelated tsc errors in app/_layout.tsx typed routes, tabs icon color and theme ColorSchemeName predate edits (no new type errors). Verify actual downloaded PNG via image inspection, plus 390x844 screenshots. Native share/Photos permissions require device testing."
  - agent: testing
    message: "Iteration 7: backend 9/9 PASS. Frontend blocked by image-ready render loop; no-photo CTA/profile upload/real Lookbook generation passed. See test_reports/iteration_7.json."
  - agent: main
    message: "Critical loop fixed with stable Image callbacks/source plus parent readiness no-op guard. Also handled RN Web onLoad event target dimensions (native source differs). Self-test 390x844 PASS: existing render displays, Share exports 390x1027 PNG with 1159 sampled colors, Save also downloads; no runtime errors. Need remaining frontend Stylist A/B flows + exported PNG visual inspection + persistence/error-retry checks. Do not repeat expensive backend matrix. All iteration7 account credentials documented."
  - agent: main
    message: "All core acceptance checks complete after iteration8 and focused follow-up. Remaining report gaps closed: no-render fixture Shared/Saved, tag changed to Work, wear count reached1, delete confirmed by API; fixture removed. Older reported image returned200/image with nonempty body 3/3 normal reads. Native share sheet/Photos/device-dark-mode verification is the remaining manual-device follow-up, not a known broken flow."