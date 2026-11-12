export type Language = "es" | "en";

const en: Record<string, string> = {
  "Tu bóveda local para secretos de desarrollo.": "Your local vault for development secrets.",
  "Contraseña maestra": "Master password", "Abrir bóveda": "Open vault", "Crear nueva": "Create new", "Crear bóveda": "Create vault", "Ya tengo una": "I already have one",
  "Sin recuperación: guarda tu contraseña maestra en un lugar seguro.": "No recovery: keep your master password in a safe place.",
  "Nueva credencial": "New credential", "COLECCIONES": "COLLECTIONS", "Todas": "All", "PROYECTOS": "PROJECTS", "Exportar backup": "Export backup", "Importar backup": "Import backup", "Bloquear": "Lock",
  "Configuración": "Settings", "General": "General", "Idioma": "Language", "Elige el idioma de la interfaz.": "Choose the interface language.",
  "Buscar en toda la bóveda…": "Search the entire vault…", "Selecciona una credencial": "Select a credential", "Editar": "Edit", "Eliminar": "Delete", "Copiar": "Copy", "Ocultar": "Hide", "Ver": "Show",
  "No hay credenciales todavía.": "No credentials yet.", "Crea una para empezar.": "Create one to get started.", "Sin proyecto": "No project", "Sin servicio": "No service", "Limpiar filtro": "Clear filter", "Subir": "Move up", "Bajar": "Move down", "opcional": "optional", "Ej: AWS, Stripe, PostgreSQL, GitHub": "e.g. AWS, Stripe, PostgreSQL, GitHub", "Plataforma o sistema al que pertenece la credencial. Opcional.": "Platform or system the credential belongs to. Optional.", "Escribe y presiona Enter o coma": "Type and press Enter or comma",
  "Editar credencial": "Edit credential", "Nombre": "Name", "Proyecto": "Project", "Entorno": "Environment", "Servicio": "Service", "Etiquetas": "Tags", "Campos": "Fields", "Secreto": "Secret", "Valor": "Value", "Quitar": "Remove", "+ Agregar campo": "+ Add field", "Cancelar": "Cancel", "Guardar": "Save", "Nueva": "New",
  "Modo": "Mode", "Elige dónde guardarla": "Choose where to save it", "Elige el archivo de la bóveda": "Choose the vault file", "Elegir ubicación…": "Choose location…", "Seleccionar archivo .dvault…": "Select .dvault file…", "Cambiar": "Change",
  "Define la contraseña maestra": "Set the master password", "Ingresa la contraseña maestra": "Enter the master password", "Primero elige el archivo": "Choose the file first", "Repite la contraseña": "Repeat the password",
  "Mínimo 10 caracteres.": "At least 10 characters.", "Repítela para confirmar.": "Repeat it to confirm.", "Las contraseñas no coinciden.": "The passwords don't match.", "Las contraseñas coinciden.": "The passwords match.",
  "Procesando…": "Working…", "Desbloquear": "Unlock", "No se pudo crear la bóveda en esa ubicación.": "Could not create the vault in that location.",
  "¿Eliminar": "Delete", "Esta acción no se puede deshacer.": "This action cannot be undone.", "Eliminar credencial": "Delete credential", "Reemplazar": "Replace",
  "El backup es válido. ¿Reemplazar la bóveda actual?": "The backup is valid. Replace the current vault?", "Introduce la contraseña del backup para validar su integridad:": "Enter the backup password to verify its integrity:",
  "Backup cifrado exportado.": "Encrypted backup exported.", "Backup restaurado correctamente.": "Backup restored successfully.", "Bóveda bloqueada.": "Vault locked.", "Bóveda creada y cifrada.": "Vault created and encrypted.", "Bóveda desbloqueada.": "Vault unlocked.",
  "Cambios guardados y cifrados.": "Changes saved and encrypted.", "Cambios no guardados: la bóveda está bloqueada.": "Changes not saved: the vault is locked.", "Campo copiado. Se limpiará en 30 segundos si no cambias el portapapeles.": "Field copied. It will be cleared in 30 seconds unless you change the clipboard.",
  "El backup no es válido o la contraseña es incorrecta.": "The backup is invalid or the password is wrong.", "No se pudieron guardar los cambios.": "Could not save the changes.", "No se pudo abrir: contraseña incorrecta o archivo inválido.": "Could not open: wrong password or invalid file.", "Usa una contraseña maestra de al menos 10 caracteres.": "Use a master password of at least 10 characters."
};

export function translate(language: Language, text: string) { return language === "en" ? (en[text] ?? text) : text; }
