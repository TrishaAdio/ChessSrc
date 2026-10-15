import type { BubbleTone } from '@/store/gameStore';
import type { BotId } from './personalities';

export type BanterEvent =
  | 'greet'
  | 'opening'
  | 'humanBrilliant'
  | 'humanGreat'
  | 'humanBlunder'
  | 'humanMistake'
  | 'botBlunder'
  | 'humanCheck'
  | 'botCheck'
  | 'humanLowTime'
  | 'botWinning'
  | 'botLosing'
  | 'win'
  | 'loss'
  | 'draw';

/** High-priority events skip the cooldown. */
export const PRIORITY: Record<BanterEvent, number> = {
  greet: 2,
  opening: 1,
  humanBrilliant: 3,
  humanGreat: 2,
  humanBlunder: 3,
  humanMistake: 1,
  botBlunder: 2,
  humanCheck: 1,
  botCheck: 1,
  humanLowTime: 2,
  botWinning: 1,
  botLosing: 1,
  win: 3,
  loss: 3,
  draw: 3,
};

export const TONE: Record<BanterEvent, BubbleTone> = {
  greet: 'warm',
  opening: 'neutral',
  humanBrilliant: 'impressed',
  humanGreat: 'impressed',
  humanBlunder: 'smug',
  humanMistake: 'neutral',
  botBlunder: 'concerned',
  humanCheck: 'concerned',
  botCheck: 'smug',
  humanLowTime: 'neutral',
  botWinning: 'smug',
  botLosing: 'concerned',
  win: 'warm',
  loss: 'impressed',
  draw: 'warm',
};

type Lines = Record<BanterEvent, readonly string[]>;

const LINES: Record<BotId, Lines> = {
  nova: {
    greet: ['Hi! Go easy on me, okay?', "I've been practicing. A little.", "Ready when you are. I think."],
    opening: ['Oh, is this the {opening}? I read about that!', '{opening}… that sounds fancy.'],
    humanBrilliant: ['Wait, you can DO that?', 'Whoa. Can you teach me that one?'],
    humanGreat: ['Ooh, nice move.', "That looked important. Was it important?"],
    humanBlunder: ['Hey, I think you dropped something!', "Is that… free? I'm taking it. Probably."],
    humanMistake: ['Hmm, was that on purpose?', 'Interesting choice!'],
    botBlunder: ['Oops. I did not see that.', "Wait, where did my piece go?", 'Let’s pretend that didn’t happen.'],
    humanCheck: ['Eek! Check!', 'Okay okay, moving the king.'],
    botCheck: ['Check! Did I do that right?', 'Check! …I think.'],
    humanLowTime: ['Your clock is getting low!', 'Tick tock! Hurry, hurry.'],
    botWinning: ['Am I… winning? Is this real?', "Don't let me win, that would be embarrassing for you."],
    botLosing: ['This is getting scary.', 'My pieces keep disappearing.'],
    win: ['I WON?! I need to tell everyone.', 'Wow. GG! That never happens.'],
    loss: ['GG! I learned a lot.', 'Good game! Rematch?'],
    draw: ['A draw! I’ll take it.', 'Nobody lost! Best outcome.'],
  },
  kael: {
    greet: ["Let's have a fun one.", 'Open game? Open game.', 'Good luck. Mostly to me.'],
    opening: ['The {opening}. Classic.', 'Ah, {opening}. I know this one… up to move six.'],
    humanBrilliant: ['Okay, that was legit beautiful.', "I'm screenshotting that."],
    humanGreat: ['Good find.', 'Yeah, that was the move.'],
    humanBlunder: ["Don't mind if I do.", 'Thanks for the gift!', 'Ooh, that hangs.'],
    humanMistake: ["Hmm, I'd have played something else.", 'That gives me ideas.'],
    botBlunder: ['Ugh. Forks. Always the forks.', 'I swear I saw that a second too late.', 'Classic me.'],
    humanCheck: ['Yeah yeah, I see it.', 'Rude.'],
    botCheck: ['Check. Your move.', 'Check! Where are you going?'],
    humanLowTime: ["Clock's ticking, friend.", 'Might want to speed up.'],
    botWinning: ['Feeling pretty good about this one.', 'This is going my way.'],
    botLosing: ["Not my finest game.", "I've been in worse spots. Actually, I haven't."],
    win: ['GG! That was fun.', 'Good game. Want revenge?'],
    loss: ['GG, well played.', 'You got me. Rematch?'],
    draw: ['Fair result. GG.', 'Peace treaty accepted.'],
  },
  vesper: {
    greet: ['Let’s make this messy.', 'I hope you like sharp positions.', 'No quiet games today.'],
    opening: ['{opening}. Now we’re talking.', 'The {opening}? Brave.'],
    humanBrilliant: ['Now THAT is chess.', 'Okay. Respect. That was gorgeous.'],
    humanGreat: ['Sharp. I like it.', 'You saw that? Good.'],
    humanBlunder: ['And there it is.', 'You blinked.', 'That’s the opening I was waiting for.'],
    humanMistake: ['Loosening up, are we?', 'That square is mine now.'],
    botBlunder: ['Too ambitious. Even for me.', 'I overcooked that one.', 'Fine. Chaos cuts both ways.'],
    humanCheck: ['A check won’t save you.', 'Cute.'],
    botCheck: ['Check. Keep running.', 'Check. The storm’s coming.'],
    humanLowTime: ['Your clock is my favourite piece right now.', 'Time trouble suits you.'],
    botWinning: ['The attack plays itself.', 'You can feel it collapsing, right?'],
    botLosing: ['Still plenty of tricks left.', 'Material is temporary.'],
    win: ['GG. Fortune favours the bold.', 'That’s how you attack. GG.'],
    loss: ['You weathered the storm. GG.', 'Well defended. Truly.'],
    draw: ['All that fire for a draw? Fine. GG.', 'Perpetual chaos, perpetual draw.'],
  },
  aegis: {
    greet: ['A pleasure. Let’s play carefully.', 'Good luck. Take your time.', 'Shall we?'],
    opening: ['The {opening}. Sound choice.', '{opening}. Rich structure.'],
    humanBrilliant: ['Exceptional. I didn’t consider that.', 'A genuinely brilliant idea.'],
    humanGreat: ['Precise.', 'The only move. Well found.'],
    humanBlunder: ['That weakens things considerably.', 'I believe that was an oversight.'],
    humanMistake: ['A small concession.', 'That structure will be hard to hold.'],
    botBlunder: ['Hm. I misjudged that.', 'A rare imprecision on my part.'],
    humanCheck: ['Noted.', 'A spite check, perhaps?'],
    botCheck: ['Check.', 'Check. Consider carefully.'],
    humanLowTime: ['Mind your clock.', 'Time is becoming a factor.'],
    botWinning: ['The endgame should be straightforward.', 'The position speaks for itself.'],
    botLosing: ['You have the upper hand. Well played so far.', 'I must defend accurately now.'],
    win: ['Good game. Your opening was instructive.', 'Thank you for the game.'],
    loss: ['Very well played. Congratulations.', 'Deserved. Thank you for the game.'],
    draw: ['A balanced result. Good game.', 'Equal, and fairly so.'],
  },
  seraph: {
    greet: ['Ready.', 'Let’s begin.', 'Good luck.'],
    opening: ['{opening}. Book.', 'Theory: {opening}.'],
    humanBrilliant: ['That’s the engine move. Impressive.', 'Brilliant. Genuinely.'],
    humanGreat: ['Correct.', 'Only move. Found.'],
    humanBlunder: ['Evaluation shift registered.', 'That one is decisive.'],
    humanMistake: ['Inaccurate.', 'Small edge, accumulating.'],
    botBlunder: ['…Unexpected.', 'Recalculating.'],
    humanCheck: ['Check acknowledged.', 'Spite check.'],
    botCheck: ['Check.', 'Check.'],
    humanLowTime: ['Your clock is a factor now.', 'Time pressure noted.'],
    botWinning: ['Converting.', 'The line is forced.'],
    botLosing: ['Remarkable. Continue.', 'This is unusual.'],
    win: ['Good game.', 'Game over. Well fought.'],
    loss: ['Extraordinary. Good game.', 'Well played. Truly rare.'],
    draw: ['Draw. Solid.', 'Balanced. Good game.'],
  },
};

const lastPicked = new Map<string, number>();

/** Picks a line for an event, avoiding immediate repeats. */
export function banterLine(bot: BotId, event: BanterEvent, vars: Record<string, string> = {}, rng: () => number = Math.random): string {
  const pool = LINES[bot][event];
  const key = `${bot}:${event}`;
  let i = Math.floor(rng() * pool.length);
  if (pool.length > 1 && i === lastPicked.get(key)) i = (i + 1) % pool.length;
  lastPicked.set(key, i);
  return pool[i]!.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');
}
