const POLICY_VERSION = '2026-09-05';

const POLICY_SECTIONS = [
  {
    title: 'Nombres de equipos',
    rules: [
      'No se permiten insultos graves, expresiones de odio o discriminación, amenazas ni acoso dirigido.',
      'No se permiten referencias sexuales explícitas, explotación de menores ni contenido extremadamente violento.',
      'No se permite suplantar a otra persona, organización o club de forma engañosa.',
      'No se permite publicar datos personales propios o de terceros en el nombre del equipo.',
      'No se permite spam, publicidad engañosa ni nombres diseñados para evadir deliberadamente los filtros.',
      'Los nombres futboleros provocadores, cargadas y rivalidades están permitidos mientras no crucen estas reglas.'
    ]
  },
  {
    title: 'Chat y reacciones',
    rules: [
      'Se permiten bromas, festejos y cargadas futboleras, pero no amenazas, acoso persistente ni ataques discriminatorios.',
      'No se permite doxxing, difusión de teléfonos, domicilios, contraseñas u otros datos personales sensibles.',
      'No se permite spam repetitivo, estafas, phishing ni enlaces maliciosos.',
      'No se permite contenido sexual explícito ni explotación de menores.',
      'Los moderadores pueden ocultar mensajes, advertir, silenciar temporalmente o suspender cuentas cuando sea necesario.'
    ]
  },
  {
    title: 'Aplicación y apelación',
    rules: [
      'Las sanciones deben ser proporcionales y dejar un registro interno con motivo y moderador responsable.',
      'Una primera infracción leve normalmente recibe advertencia; reincidencias pueden generar mute o suspensión.',
      'Odio, amenazas creíbles, doxxing, explotación sexual de menores o intentos de comprometer la plataforma pueden implicar suspensión inmediata.',
      'Los administradores pueden revisar y revertir decisiones de moderación.'
    ]
  }
];

function publicPolicy() {
  return { version: POLICY_VERSION, title: 'Política de convivencia y moderación de Ankara GOAT', sections: POLICY_SECTIONS };
}

module.exports = { POLICY_VERSION, POLICY_SECTIONS, publicPolicy };
