let activeModal = null;

function closeActiveModal(result) {
  if (!activeModal) return;
  const { root, resolve, keydownHandler } = activeModal;
  document.removeEventListener('keydown', keydownHandler);
  root.remove();
  activeModal = null;
  resolve(result);
}

export function showModal({
  title,
  message = '',
  fields = [],
  submitText = '确定',
  cancelText = '取消',
  danger = false,
} = {}) {
  if (activeModal) closeActiveModal(null);

  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.className = 'modal-backdrop';

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'modal-title');

    const header = document.createElement('div');
    header.className = 'modal-header';
    const heading = document.createElement('h2');
    heading.id = 'modal-title';
    heading.className = 'modal-title';
    heading.textContent = title;
    header.appendChild(heading);
    modal.appendChild(header);

    const body = document.createElement('div');
    body.className = 'modal-body';

    const form = document.createElement('form');
    form.className = 'modal-form';
    form.noValidate = false;

    if (message) {
      const messageEl = document.createElement('p');
      messageEl.className = 'modal-message';
      messageEl.textContent = message;
      form.appendChild(messageEl);
    }

    for (const field of fields) {
      const wrapper = document.createElement('div');
      wrapper.className = 'field';

      const label = document.createElement('label');
      label.textContent = field.label;
      wrapper.appendChild(label);

      let input;
      if (field.type === 'select') {
        input = document.createElement('select');
        for (const option of field.options || []) {
          const optionEl = document.createElement('option');
          optionEl.value = option.value;
          optionEl.textContent = option.label;
          input.appendChild(optionEl);
        }
      } else {
        input = document.createElement('input');
        input.type = field.type || 'text';
      }
      input.name = field.name;
      if (field.value !== undefined && field.value !== null) input.value = field.value;
      if (field.placeholder) input.placeholder = field.placeholder;
      if (field.required) input.required = true;
      wrapper.appendChild(input);
      form.appendChild(wrapper);
    }

    body.appendChild(form);
    modal.appendChild(body);

    const footer = document.createElement('div');
    footer.className = 'modal-footer';

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'btn';
    cancelButton.textContent = cancelText;
    cancelButton.addEventListener('click', () => closeActiveModal(null));

    const submitButton = document.createElement('button');
    submitButton.type = 'submit';
    submitButton.className = danger ? 'btn danger' : 'btn accent';
    submitButton.textContent = submitText;

    footer.append(cancelButton, submitButton);
    modal.appendChild(footer);
    root.appendChild(modal);
    document.body.appendChild(root);

    const keydownHandler = (event) => {
      if (event.key === 'Escape') closeActiveModal(null);
    };
    document.addEventListener('keydown', keydownHandler);
    root.addEventListener('mousedown', (event) => {
      if (event.target === root) closeActiveModal(null);
    });

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;

      if (fields.length === 0) {
        closeActiveModal(true);
        return;
      }

      const values = {};
      for (const field of fields) {
        values[field.name] = form.elements[field.name].value;
      }
      closeActiveModal(values);
    });

    activeModal = { root, resolve, keydownHandler };
    (form.elements[fields[0]?.name] || cancelButton).focus();
  });
}

export function showConfirm(options = {}) {
  return showModal({
    submitText: options.submitText || '确定',
    danger: options.danger !== false,
    ...options,
  });
}
