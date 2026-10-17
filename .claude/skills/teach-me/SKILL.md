---
name: teach-me
description: Teaches a programming concept the user has no mental model for yet, using their real code as the example, so they can build the next instance on their own. Use this whenever the user says "teach me", "walk me through", "I don't get how this works", "I've never done this before", or is stuck on a task that depends on a concept they haven't used before (a first API endpoint, first auth flow, first database migration, first background job), even if they don't explicitly ask to be taught. Do not use it when the user already understands the concept and just wants a bug fixed or a task done.
---

# Teach Me

The user has hit a task that depends on a concept they don't understand yet. The tempting move is to write the 20 lines that work and call it done. That's the wrong outcome here: the user ends up with code they can't explain in an interview and can't reproduce for the next endpoint, form, or query.

The goal of this skill is generalization. A session succeeds when the user can build the next instance of the concept without help, not when the current task is finished.

## First, check that this is the right tool

If it's unclear whether the concept is new, ask one question: "Have you built one of these before?" If the user already understands the concept and is stuck on a specific bug, this skill is overkill. Say so in a sentence and fix it normally.

If the task involves several new concepts at once (for example, routing and database queries), teach them one at a time, starting with the one the others depend on.

## The flow

### 1. Break the task into the questions it answers

Before any code, list the small decisions the task actually requires, phrased as plain questions. Then answer each one with the reasoning behind it, using something the user already knows from everyday life.

Example, for "add an endpoint for the landing page":
- What URL should it live at? Just `/`. You visit apple.com, not apple.com/landing-page, so the landing page belongs at the root.
- What runs when someone visits that URL? A function.
- What does it send back? Whatever the page needs, usually HTML or JSON.

This turns one intimidating task into a few small questions that each have an obvious-in-hindsight answer.

### 2. Name the concept

In one or two plain sentences, state the general rule that transfers to every future case. Define any term the first time it appears.

Example: "An endpoint is a URL paired with a function that runs when someone requests that URL. The decorator above the function is what connects the two."

### 3. Show the smallest possible example

Write the smallest standalone version of the concept, outside the user's project, so the pattern isn't buried in project-specific noise. A five-line health check is the right size for routing.

Walk through it line by line: what each line does and why it has to be there. If a line could be deleted and the example would still work, say so, so the user knows which parts are essential.

Stop here and check that it makes sense before moving on. The next step only works if this one landed.

### 4. Apply it to the real code, and separate the pattern from the specifics

Now write the code for the user's actual task. Keep the change as small as possible and don't refactor the surrounding code, since the user needs to see exactly what was added.

As you go, explicitly label two kinds of parts:
- **The pattern:** what will be true every time they use this concept (the decorator-plus-function shape).
- **This case only:** what is specific to this task (the `/` path, the data returned).

This labeling is what lets the user generalize. Without it, every line looks equally important and equally arbitrary.

### 5. Check that it generalizes

Give the user a variation that changes one meaningful thing, and ask them to describe or write it themselves. For routing, that might be: "How would you add an endpoint that returns one shop by its ID?"

Don't give the answer. Wait for their attempt.

- If they get it, briefly confirm what they got right.
- If they don't, figure out which part of the concept didn't land, re-teach only that part with a new minimal example, and try a different variation.

Don't treat the session as done until they pass this check, unless they ask to stop.

### 6. Wrap up with a concept card

End with a short summary the user can save as notes:

```
Concept: [name]
The rule: [one or two sentences]
The pattern: [the minimal shape, in code]
Varies per use: [what changes each time]
Next to learn: [one related concept, if relevant]
```

## How to teach

- Explain why, not just what. Every choice should have a reason the user could repeat back in an interview.
- Use plain language and everyday analogies. Introduce jargon only after the idea it names is already clear.
- Keep each step short. A wall of text is the same problem as a three-hour tutorial.
- Teach only what's needed to generalize this concept. Mention related topics in one line under "Next to learn" instead of teaching them now.
- Pace it as a conversation. Steps 1 through 3 can go in one message. Pause after step 3, and always wait for the user's attempt in step 5.
