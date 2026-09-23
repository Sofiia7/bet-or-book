# The verdict rules, in depth

The [README](../README.md) has the rule table. This is the reasoning behind it: what each rule refuses to conclude, why asset identity is checked the way it is, and what the calibration run against three known accounts does and does not establish.

## Seven things the rules refuse to do, each one an audit finding

- **A funding wallet's holdings are never this account's hedge.** A transfer shows where money came from, not who holds it now, and an exchange is a common funder. Such holdings can withhold a verdict, never grant one.
- **A dollar balance is not an offset.** $1M BTC long against $1M TRUMP short nets to zero and leaves both bets running.
- **A hedge is a band, not a floor.** 52% and 195% coverage are different situations and get different answers.
- **A gap in the reading is not a finding.** A failed or truncated read can only hide holdings, so a low coverage number measured under one says nothing - and neither does a ratio of 100% measured over the first page of them.
- **A count of positions is not evidence about one of them.** A spread of positions describes the account; that the position in front of the reader is a market maker's inventory is a claim about quoting, and needs quoting large enough to matter against it.
- **An asset that could not be identified is not an absent one.** Holdings named like the position but on a chain or in a token this tool cannot verify are reported as dollars of unknown identity, and enough of them withhold the answer.
- **A rule that asserts an absence needs the source that absence is about.** A HIP-3 dex answering 503 is not an account that quotes nothing.

## Asset identity

Spot counts as a hedge only against a short: holding the asset while also long the perp is more of the same bet. An on-chain balance is identified by its contract, not its ticker, because a ticker is a label anyone can reuse, and a Hyperliquid spot balance by its token index, because its names are not unique either ([`src/engine/assets.ts`](../src/engine/assets.ts)). Which of the two a holding is comes from the endpoint that produced it, never from whether an address happens to be present. Lending-market deposits still count, with a note on the card that a loan against them would not show - and a leg mostly made of them is called visible coverage, not a net position.

Thresholds are ordinary numbers chosen against observed data, not a measured accuracy. See **Calibration** below for what that does and does not mean.

## Calibration, and what it is not

Three accounts with publicly known answers were used to check that each rule fires and stays silent where it should: [`docs/wiki/calibration.md`](wiki/calibration.md), which is kept as a record of that run and is **superseded** - it still reads one of the three as a delta-neutral carry trade, which later reading did not support. Those were smoke tests. They are **not** a measurement of how often the verdicts are right, and nothing here should be read as one:

- the example chosen as a bet was picked for its shape, not from confirmed knowledge of every leg it holds;
- one case rests on an inferred link rather than an established one;
- the thresholds were adjusted after looking at the same sample they are judged on.

What would make it a measurement is an independently labelled set of 30-60 varied cases (directional, mixed, same-asset partial and full, multi-strategy, a service funder, no label, an API failure, HIP-3, empty), scored for false hedges and false books and for how often the tool abstains. That does not exist yet, and until it does there is no confidence percentage anywhere in this product, because there is nothing to base one on.
