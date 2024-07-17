import { Effect, Option } from "effect"
import { Git } from "./Git"
import * as Config from "./Config"
import { PullRequests } from "./PullRequests"
import { Command } from "@effect/platform"
import { Github } from "./Github"
import { Comments } from "./Comments"
import { Permissions } from "./Permissions"

export const runComment = Effect.gen(function* () {
  const comments = yield* Comments
  const perms = yield* Permissions

  yield* perms.whenCollaboratorOrAuthor(
    Effect.gen(function* () {
      yield* comments.reactCurrent("rocket")
      yield* runCurrent
    }),
  )
})

export const run = Effect.gen(function* () {
  const git = yield* Git.pipe(Effect.flatMap(_ => _.open(".")))
  const prefix = yield* Config.prefix
  const base = yield* Config.baseBranch

  yield* Effect.log(`rebasing ${prefix}-major on ${prefix}-minor`)
  yield* git
    .run(_ =>
      _.fetch("origin")
        .checkout(`${prefix}-minor`)
        .checkout(`${prefix}-major`)
        .rebase([`${prefix}-minor`])
        .push(["--force"]),
    )
    .pipe(
      Effect.tapError(_ => git.run(_ => _.rebase(["--abort"]))),
      Effect.catchAllCause(Effect.log),
    )

  yield* Effect.log(`rebasing ${prefix}-minor on ${base}`)
  yield* git
    .run(_ =>
      _.checkout(base)
        .checkout(`${prefix}-minor`)
        .rebase([base])
        .push(["--force"]),
    )
    .pipe(
      Effect.tapError(_ => git.run(_ => _.rebase(["--abort"]))),
      Effect.catchAllCause(Effect.log),
    )

  yield* Effect.log(`rebasing ${prefix}-major on ${prefix}-minor`)
  yield* git
    .run(_ =>
      _.checkout(`${prefix}-major`)
        .rebase([`${prefix}-minor`])
        .push(["--force"]),
    )
    .pipe(
      Effect.tapError(_ => git.run(_ => _.rebase(["--abort"]))),
      Effect.catchAllCause(Effect.log),
    )
})

export const runCurrent = Effect.gen(function* () {
  const gh = yield* Github
  const git = yield* Git.pipe(Effect.flatMap(_ => _.open(".")))
  const prefix = yield* Config.prefix
  const pulls = yield* PullRequests

  const current = yield* pulls.current.pipe(
    Effect.filterOrFail(
      pull =>
        pull.base.ref === `${prefix}-major` ||
        pull.base.ref === `${prefix}-minor`,
    ),
    Effect.option,
  )
  if (Option.isNone(current)) {
    return
  }

  const pull = current.value
  yield* git.run(_ => _.fetch("origin").checkout(pull.base.ref))

  yield* Effect.log(`rebasing #${pull.number} on ${pull.base.ref}`)
  const remote =
    pull.head.repo!.owner.login === pull.base.repo.owner.login
      ? "origin"
      : pull.head.repo!.owner.login
  yield* gh
    .cli("pr", "checkout", "-b", "pr-branch", "--force", pull.number.toString())
    .pipe(Command.exitCode)
  yield* git
    .run(_ =>
      _.rebase([pull.base.ref]).push([
        remote,
        `pr-branch:${pull.head.ref}`,
        "--force",
      ]),
    )
    .pipe(Effect.tapError(_ => git.run(_ => _.rebase(["--abort"]))))
})
