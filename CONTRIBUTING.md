# Contributing to OpenSubs

Issues, bug reports and feature requests are always welcome and need nothing
from you beyond a clear description.

**Code contributions need one extra step, once:** agree to the
[Contributor Licence Agreement](CLA.md).

## The short version

OpenSubs is AGPL-3.0-or-later to the public, and is also distributed by the
maintainer through channels — Apple’s App Store among them — whose terms are
incompatible with the AGPL. That is only possible while the Project Owner holds
copyright in the whole work, because a licence does not bind the person
granting it.

A merged contribution from someone who has not signed makes that impossible for
every build containing it. The CLA keeps you as the copyright owner of your
work and grants the Project Owner the right to distribute it under other terms as
well. It is the same arrangement Qt, Grafana and Element use, and for the same
reason.

## Where the source lives

The source of truth is a private GitLab repository. This GitHub repository
mirrors its app code (not the website): after a change is pushed to GitLab
`main`, a maintainer runs the mirror script, which commits the same tree
here as one commit naming the GitLab commit it came from. Release tags
are cut here, on `main` itself and only right after a sync, so at every
release `main` and the release tag are the same commit; GitHub Actions
builds the installers from that tree.
Pull requests opened here are ported to GitLab and come back through the
mirror, so nothing is pushed to this repository's `main` by hand.

## Making a change

1. Open an issue first for anything substantial, so the approach can be agreed
   before you spend time on it.
2. Fork, branch, and keep the change focused on one thing.
3. Match the surrounding code — its naming, its idiom, its comment density.
4. Run the project’s test suite and say in the pull request what you ran.
5. Open the pull request. On your **first** one, tick the CLA box in the
   template. You only do this once.

## If you would rather not sign

That is a reasonable position and it does not shut you out. Open an issue
describing the change — what is wrong, what it should do, and how you would
approach it — and the Project Owner can implement it independently. What cannot
happen is merging your code without the agreement, because that forecloses a
distribution channel the project already uses.
