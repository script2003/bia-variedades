"""Expressões usadas pela detecção de cortes, por idioma.

As expressões são escritas com acentos (é assim que aparecem nas explicações), mas a
comparação ignora acentos e maiúsculas: tanto a expressão quanto o texto são normalizados.
``dependent_starts``, ``fillers`` e ``stopwords`` já estão na forma normalizada. As listas são deliberadamente
curtas e legíveis — elas explicam a pontuação e podem ser ampliadas com facilidade.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Lexicon:
    impact: tuple[str, ...]
    opinion: tuple[str, ...]
    contrast: tuple[str, ...]
    story_start: tuple[str, ...]
    story_middle: tuple[str, ...]
    story_end: tuple[str, ...]
    topic_shift: tuple[str, ...]
    question_starts: tuple[str, ...]
    direct_address: tuple[str, ...]
    dependent_starts: frozenset[str]
    fillers: frozenset[str]
    stopwords: frozenset[str]


PT = Lexicon(
    impact=(
        "o segredo", "segredo", "ninguém fala", "ninguém te conta", "a verdade é", "a verdade",
        "o maior erro", "maior erro", "o problema é", "presta atenção", "mudou minha vida",
        "mudou tudo", "você precisa", "o mais importante", "a coisa mais", "incrível", "absurdo",
        "chocante", "impressionante", "perigoso", "nunca", "jamais", "ninguém", "todo mundo",
        "milhões", "bilhões", "por cento", "literalmente", "de jeito nenhum", "pior", "melhor coisa",
        "primeira vez", "vou te contar", "deixa eu te contar", "sabe o que", "imagina", "pensa comigo",
        "o que ninguém", "erro", "fracasso", "mentira", "verdade", "loucura",
        "inacreditável", "surreal", "fundamental", "essencial", "cuidado",
    ),
    opinion=(
        "eu acho", "acho que", "na minha opinião", "eu acredito", "eu penso", "pra mim", "para mim",
        "discordo", "concordo", "não concordo", "sinceramente", "honestamente", "não é verdade",
        "isso é mentira", "eu defendo", "sou contra", "sou a favor", "com certeza", "errado",
        "eu discordo", "tenho certeza", "eu não acho", "o meu ponto", "meu ponto é", "o certo é",
    ),
    contrast=(
        "mas", "porém", "entretanto", "so que", "pelo contrário", "por outro lado", "no entanto",
        "apesar", "contudo", "todavia",
    ),
    story_start=(
        "uma vez", "certa vez", "teve uma vez", "eu lembro", "lembro que", "lembro de", "quando eu",
        "um dia", "era uma vez", "naquela época", "anos atrás", "conheci", "aconteceu", "na época",
        "quando eu era", "minha história", "vou contar uma história",
    ),
    story_middle=(
        "aí", "então", "de repente", "depois", "foi quando", "nesse momento", "comecei", "resolvi",
        "decidi", "na hora", "no dia seguinte",
    ),
    story_end=(
        "no final", "no fim", "aprendi", "a lição", "moral da história", "por isso", "foi assim que",
        "resultado", "hoje eu", "desde então", "conclusão", "resumindo", "e foi aí que", "finalmente",
    ),
    topic_shift=(
        "mudando de assunto", "outra coisa", "falando nisso", "falando em", "agora vamos",
        "próxima pergunta", "outro ponto", "outro tema", "voltando ao", "próximo assunto",
        "vamos falar de", "vamos falar sobre", "agora eu quero",
    ),
    question_starts=(
        "por que", "porque", "como", "o que", "qual", "quais", "quando", "onde", "quem", "quanto",
        "será que", "você ja", "você acha", "e se",
    ),
    direct_address=("você", "vocês", "te ", "tu "),
    dependent_starts=frozenset(
        "e mas entao porque que isso isto ele ela eles elas la ai tambem nisso dai pois ou nem "
        "aquilo esse essa".split()
    ),
    fillers=frozenset("ne tipo hum hm ahn ah eh uh uhm hmm assim sabe ta".split()),
    stopwords=frozenset(
        "a o as os um uma uns umas de da do das dos em no na nos nas por para pra pro com sem que "
        "e ou mas se nao sim eu tu ele ela nos vos eles elas me te se lhe isso isto aquilo esse essa "
        "este esta ser estar ter foi era sao tem tinha muito mais menos ja tambem entao ai la aqui "
        "ne tipo assim bem como quando onde porque voce voces meu minha seu sua dele dela ao aos "
        "pelo pela vai vou ta tava fazer faz coisa gente".split()
    ),
)

EN = Lexicon(
    impact=(
        "the secret", "nobody talks", "nobody tells", "the truth is", "the biggest mistake", "the problem is",
        "pay attention", "changed my life", "you need to", "the most important", "incredible", "insane",
        "shocking", "never", "nobody", "everyone", "millions", "billions", "percent", "literally",
        "no way", "worst", "first time", "let me tell you", "imagine", "mistake", "failure", "success",
        "lie", "truth", "crazy", "unbelievable", "essential", "careful",
    ),
    opinion=(
        "i think", "in my opinion", "i believe", "i feel like", "for me", "i disagree", "i agree",
        "honestly", "frankly", "that's not true", "that is not true", "i'm against", "i'm for",
        "of course", "wrong", "my point is", "i'm sure",
    ),
    contrast=("but", "however", "although", "on the other hand", "instead", "though", "yet"),
    story_start=(
        "one time", "once", "i remember", "when i was", "one day", "years ago", "back then", "i met",
        "it happened", "let me tell you a story",
    ),
    story_middle=("then", "suddenly", "after that", "that's when", "so i", "i decided", "next day"),
    story_end=(
        "in the end", "i learned", "the lesson", "that's why", "that is why", "the result", "today i",
        "ever since", "in conclusion", "finally",
    ),
    topic_shift=("changing the subject", "another thing", "speaking of", "next question", "moving on", "let's talk about"),
    question_starts=("why", "how", "what", "which", "when", "where", "who", "do you", "have you", "is it", "what if"),
    direct_address=("you ", "your "),
    dependent_starts=frozenset("and but so because that this it he she they them then also or".split()),
    fillers=frozenset("uh um uhm hmm like yeah well".split()),
    stopwords=frozenset(
        "a an the of to in on at for with without and or but if not no yes i you he she we they me "
        "him her us them it this that these those is are was were be been have has had do does did "
        "very more less so then there here my your his its our their just like really".split()
    ),
)

ES = Lexicon(
    impact=(
        "el secreto", "nadie habla", "la verdad es", "el mayor error", "el problema es", "presta atención",
        "cambió mi vida", "necesitas", "lo más importante", "increíble", "absurdo", "nunca", "jamás",
        "nadie", "todo el mundo", "millones", "por ciento", "literalmente", "peor", "primera vez",
        "te voy a contar", "imagina", "error", "mentira", "verdad", "locura",
    ),
    opinion=(
        "yo creo", "creo que", "en mi opinión", "pienso que", "para mí", "no estoy de acuerdo",
        "estoy de acuerdo", "sinceramente", "honestamente", "no es verdad", "estoy en contra",
        "por supuesto", "equivocado",
    ),
    contrast=("pero", "sin embargo", "aunque", "por otro lado", "al contrario", "no obstante"),
    story_start=("una vez", "recuerdo", "cuando yo", "un día", "hace años", "en esa época", "conocí", "pasó que"),
    story_middle=("entonces", "de repente", "después", "fue cuando", "decidí", "empecé"),
    story_end=("al final", "aprendí", "la lección", "por eso", "el resultado", "hoy yo", "desde entonces", "en conclusión"),
    topic_shift=("cambiando de tema", "otra cosa", "hablando de", "siguiente pregunta", "vamos a hablar de"),
    question_starts=("por que", "como", "que", "cual", "cuando", "donde", "quien", "cuanto", "has"),
    direct_address=("tú ", "usted", "ustedes", "te "),
    dependent_starts=frozenset("y pero entonces porque que eso esto el ella ellos tambien o".split()),
    fillers=frozenset("eh este pues bueno o sea tipo".split()),
    stopwords=frozenset(
        "a el la los las un una de del en por para con sin que y o pero si no yo tu el ella nosotros "
        "ellos me te se le eso esto ese esa ser estar tener fue era son muy mas menos ya tambien "
        "entonces ahi aqui como cuando donde porque mi su".split()
    ),
)

LEXICONS: dict[str, Lexicon] = {"pt": PT, "en": EN, "es": ES}


def lexicon_for(language: str) -> Lexicon:
    """Retorna o léxico do idioma (o português é usado quando não há léxico específico)."""
    return LEXICONS.get(language.split("-", 1)[0].lower(), PT)


def has_lexicon(language: str) -> bool:
    return language.split("-", 1)[0].lower() in LEXICONS
