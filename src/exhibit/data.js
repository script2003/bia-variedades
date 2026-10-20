// Conteúdo educativo da exposição (português do Brasil).

export const AREAS = [
  {
    id: 'fogoes',
    n: 1,
    title: 'Fogões',
    span: 'Anos 1950 → hoje',
    old: 'stoveOld',
    modern: 'stoveModern',
    intro:
      'Do esmalte vitrificado aceso com fósforo ao inox com acendimento automático e válvula de segurança.',
    rows: [
      ['Materiais', 'Chapa de aço esmaltada, ferro fundido, cromados e baquelite', 'Aço inox escovado, vidro temperado, ferro fundido e alumínio'],
      ['Design', 'Cantos arredondados, painel traseiro com relógio, cor creme', 'Linhas retas, mesa de vidro preto e acabamento metálico'],
      ['Tamanho', '76 × 62 × 112 cm (com painel traseiro), 4 bocas', '76 × 64 × 88 cm, 5 bocas'],
      ['Controles', 'Registros de baquelite e termostato analógico', 'Botões com acendimento automático e timer digital'],
      ['Tecnologia', 'Acendimento manual com fósforo; forno sem visor', 'Faísca elétrica, termopar que corta o gás, forno com visor e luz'],
    ],
  },
  {
    id: 'geladeiras',
    n: 2,
    title: 'Geladeiras',
    span: 'Anos 1950 → hoje',
    old: 'fridgeOld',
    modern: 'fridgeModern',
    intro:
      'Da porta única com trinco de alavanca e degelo manual às portas duplas com Frost Free e painel digital.',
    rows: [
      ['Materiais', 'Aço esmaltado, interior de porcelana e cromados', 'Portas de aço inox, interior de plástico ABS e vidro temperado'],
      ['Design', 'Corpo arredondado e uma única porta', 'French Door: duas portas em cima e gaveta de freezer embaixo'],
      ['Tamanho', '70 × 73 × 150 cm, cerca de 220 litros', '91 × 76 × 178 cm, cerca de 550 litros'],
      ['Controles', 'Termostato giratório dentro do gabinete', 'Painel digital com a temperatura de cada compartimento'],
      ['Tecnologia', 'Condensador exposto na traseira, gás CFC, degelo manual', 'Compressor inverter, gás R600a, Frost Free e LED'],
    ],
  },
  {
    id: 'televisoes',
    n: 3,
    title: 'Televisões',
    span: 'Anos 1980 → hoje',
    old: 'tvOld',
    modern: 'tvModern',
    intro:
      'Do tubo de raios catódicos em gabinete de madeira ao painel de LED com poucos centímetros de espessura.',
    rows: [
      ['Materiais', 'Gabinete de madeira, plástico e vidro grosso', 'Alumínio, plástico, vidro fino e filmes ópticos'],
      ['Design', 'Caixa profunda, tela convexa 4:3, controles à direita', 'Perfil fino, bordas estreitas, tela plana 16:9'],
      ['Tamanho', 'Tela de 20″; 64 × 48 × 48 cm; cerca de 25 kg', 'Tela de 55″; 123 × 71 × 5 cm; cerca de 15 kg'],
      ['Controles', 'Seletor giratório de canais VHF/UHF, volume e brilho', 'Controle remoto, comandos de voz e menus na tela'],
      ['Tecnologia', 'Tubo CRT e sinal analógico PAL-M de 525 linhas', 'LCD com retroiluminação LED, 4K, Wi-Fi e HDMI'],
    ],
  },
];

export const MODELS = {
  stoveOld: {
    area: 'fogoes', kind: 'old', hash: 'fogao-antigo', file: 'fogao-antigo-anos-1950.glb',
    name: 'Fogão a gás esmaltado', chip: 'Fogão esmaltado', era: 'Anos 1940–1960',
    desc: 'Fogão de piso em chapa de aço coberta por esmalte vitrificado, com registros de baquelite e painel traseiro com relógio. O gás era aceso com fósforo e o forno não tinha visor.',
    specs: [
      ['Dimensões', '76 × 62 × 112 cm (com o painel traseiro)'],
      ['Materiais', 'Aço esmaltado, ferro fundido, cromados e baquelite'],
      ['Controles', '4 registros de queimador, termostato do forno, relógio e timer mecânicos'],
    ],
    highlights: [
      'Grelhas individuais de ferro sobre bacias cromadas',
      'Forno esmaltado com prateleiras de arame e porta que abre para baixo',
      'Gaveta inferior para guardar assadeiras',
      'Tomada auxiliar no painel traseiro, comum na época',
    ],
  },
  stoveModern: {
    area: 'fogoes', kind: 'new', hash: 'fogao-atual', file: 'fogao-atual-inox.glb',
    name: 'Fogão inox de 5 bocas', chip: 'Fogão inox', era: 'Atual',
    desc: 'Mesa de vidro temperado, queimadores com acendimento automático e grelhas contínuas de ferro fundido. A porta do forno tem vidro duplo com visor e o painel traz um timer digital.',
    specs: [
      ['Dimensões', '76 × 64 × 88 cm (tampa fechada)'],
      ['Materiais', 'Aço inox escovado, vidro temperado, ferro fundido e alumínio'],
      ['Controles', '6 botões com acendimento automático e timer digital'],
    ],
    highlights: [
      'Queimador tripla chama no centro da mesa',
      'Termopar: válvula que corta o gás se a chama apagar',
      'Vela de ignição de cerâmica ao lado de cada queimador',
      'Tampa de vidro articulada e luz interna no forno',
    ],
  },
  fridgeOld: {
    area: 'geladeiras', kind: 'old', hash: 'geladeira-antiga', file: 'geladeira-antiga-anos-1950.glb',
    name: 'Geladeira de porta única', chip: 'Geladeira arredondada', era: 'Anos 1950',
    desc: 'Gabinete de aço esmaltado com cantos arredondados e uma única porta presa por trinco de alavanca. O pequeno congelador interno exigia degelo manual, e o condensador em serpentina ficava exposto na traseira.',
    specs: [
      ['Dimensões', '70 × 73 × 150 cm, cerca de 220 litros'],
      ['Materiais', 'Aço esmaltado, interior de porcelana, cromados e borracha'],
      ['Controles', 'Termostato giratório dentro do gabinete'],
    ],
    highlights: [
      'Trinco mecânico na alavanca (a vedação magnética só se popularizou depois)',
      'Congelador de alumínio com bandeja para a água do degelo',
      'Serpentina do condensador e compressor aparentes na traseira',
      'Gás CFC, hoje proibido por danificar a camada de ozônio',
    ],
  },
  fridgeModern: {
    area: 'geladeiras', kind: 'new', hash: 'geladeira-atual', file: 'geladeira-atual-french-door.glb',
    name: 'Geladeira French Door Frost Free', chip: 'Geladeira French Door', era: 'Atual',
    desc: 'Duas portas superiores e uma gaveta de freezer embaixo, com portas de aço inox e um painel digital discreto. O sistema Frost Free faz o ar frio circular e dispensa o degelo.',
    specs: [
      ['Dimensões', '91 × 76 × 178 cm, cerca de 550 litros'],
      ['Materiais', 'Aço inox, plástico ABS, vidro temperado e LED'],
      ['Controles', 'Painel digital com a temperatura do refrigerador e do freezer'],
    ],
    highlights: [
      'Compressor inverter, que ajusta a velocidade e economiza energia',
      'Gás R600a, de baixo impacto ambiental',
      'Vedação magnética nas portas e na gaveta',
      'Prateleiras de vidro, gavetas de legumes e iluminação LED',
    ],
  },
  tvOld: {
    area: 'televisoes', kind: 'old', hash: 'tv-antiga', file: 'tv-antiga-tubo-crt.glb',
    name: 'Televisor de tubo em cores', chip: 'TV de tubo', era: 'Anos 1970–1980',
    desc: 'Gabinete de madeira com tela convexa de 20 polegadas, seletor giratório de canais e antena interna. A imagem é formada no tubo de raios catódicos: um feixe de elétrons percorre a tela linha por linha.',
    specs: [
      ['Dimensões', '64 × 48 × 48 cm, cerca de 25 kg'],
      ['Materiais', 'Folheado de madeira, plástico, alumínio e vidro grosso'],
      ['Controles', 'Seletor de canais VHF/UHF, volume (puxe para ligar) e brilho'],
    ],
    highlights: [
      'Tela 4:3 e sinal analógico PAL-M, de 525 linhas',
      'Tampa traseira volumosa para abrigar o tubo e a bobina defletora',
      'Antena interna "orelha de coelho" com aro de UHF',
      'Alta tensão no tubo: o aviso na traseira pede serviço técnico',
    ],
  },
  tvModern: {
    area: 'televisoes', kind: 'new', hash: 'tv-atual', file: 'tv-atual-led-55.glb',
    name: 'Smart TV LED de 55″ 4K', chip: 'Smart TV 4K', era: 'Atual',
    desc: 'Painel plano de cristal líquido iluminado por LEDs, com bordas de poucos milímetros e resolução 4K. Conecta-se à internet e recebe imagem digital pelos cabos HDMI.',
    specs: [
      ['Dimensões', '123 × 71 × 5 cm sem os pés, cerca de 15 kg'],
      ['Materiais', 'Alumínio, plástico, vidro fino e filmes ópticos'],
      ['Controles', 'Controle remoto, comandos de voz e menus na tela'],
    ],
    highlights: [
      'Resolução de 3840 × 2160, cerca de 8,3 milhões de pixels',
      'Camadas: vidro, painel LCD, filmes ópticos, difusor e LEDs',
      'Conexões HDMI, USB, rede, áudio óptico e antena digital',
      'Fixação na parede pelo padrão VESA 300 × 300 mm',
    ],
  },
};
