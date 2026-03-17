name: crowwire-news-monitor
args:
  config:
    default: "/opt/crowwire/feeds.yaml"
  db:
    default: "/opt/crowwire/crowwire.db"
  channel:
    default: "news"
steps:
  - id: fetch
    run: crowwire-cli fetch --config ${config}

  - id: dedup
    run: crowwire-cli dedup --db ${db}
    stdin: $fetch.stdout

  - id: score
    run: crowwire-cli score
    stdin: $dedup.stdout

  - id: classify
    run: crowwire-cli classify --db ${db} --similarity-threshold 0.55 --sent-event-ttl 24
    stdin: $score.stdout

  - id: deliver-urgent
    run: crowwire-cli format --type urgent
    stdin: $classify.stdout

  - id: send-urgent
    run: crowwire-cli send --channel ${channel}
    stdin: $deliver-urgent.stdout

  - id: deliver-digest
    run: crowwire-cli format --type digest
    stdin: $classify.stdout

  - id: send-digest
    run: crowwire-cli send --channel ${channel}
    stdin: $deliver-digest.stdout
