name: lobster-syntax-test
steps:
  - id: step-a
    command: echo '{"items":[1,2,3],"flag":true}'

  - id: step-b
    command: cat
    stdin: $step-a.stdout

  - id: step-c
    command: echo "conditional step ran"
    condition: $step-b.json.flag
