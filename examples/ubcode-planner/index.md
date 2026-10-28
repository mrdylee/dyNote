# Dynote planner traceability example

Synthetic requirements for the capture workflow. This is an evaluation model, not a claim that trace links alone prove product correctness.

```{req} Review extracted schedules
:id: REQ_REVIEW

The user can edit extracted dates before registering a milestone.
```

```{req} Preserve uncertainty
:id: REQ_YEAR

Missing years remain undated until the user confirms a date.
```

```{req} Keep evidence
:id: REQ_SOURCE

Registered milestones retain a link to the source image.
```

```{spec} Capture review workspace
:id: DES_REVIEW
:implements: REQ_REVIEW, REQ_YEAR

Show an image beside editable milestone fields and mark uncertain dates.
```

```{spec} Vault persistence
:id: DES_STORE
:implements: REQ_SOURCE

Store the image in attachments and link it from the planner Markdown note.
```

```{test} Edit an extracted date
:id: TEST_REVIEW
:tests: REQ_REVIEW

Capture a synthetic schedule, edit its end date, register and check the saved date.
```

```{test} Missing-year capture
:id: TEST_YEAR
:tests: REQ_YEAR

Capture a date without a year and verify both date fields remain empty.
```

```{test} Source after restart
:id: TEST_SOURCE
:tests: REQ_SOURCE

Restart the application and open the source image from the milestone.
```
