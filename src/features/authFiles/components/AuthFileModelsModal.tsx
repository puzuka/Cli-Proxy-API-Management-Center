import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconCheck, IconPlus, IconTrash2, IconX } from '@/components/ui/icons';
import type { AuthFileModelItem } from '@/features/authFiles/constants';
import { isModelExcluded } from '@/features/authFiles/constants';
import type { ModelTestState } from '@/features/authFiles/hooks/useAuthFilesModels';
import styles from '@/pages/AuthFilesPage.module.scss';

export type AuthFileModelsModalProps = {
  open: boolean;
  fileName: string;
  fileType: string;
  loading: boolean;
  saving: boolean;
  error: 'unsupported' | null;
  models: AuthFileModelItem[];
  manual: boolean;
  excluded: Record<string, string[]>;
  testStatuses: Record<string, ModelTestState>;
  onClose: () => void;
  onCopyText: (text: string) => void;
  onSaveModels: (models: AuthFileModelItem[]) => Promise<void>;
  onTestModel: (modelId: string) => void;
};

type ModelEditorState = {
  mode: 'add' | 'edit';
  originalId?: string;
};

type ModelFormState = {
  id: string;
  display_name: string;
  type: string;
  owned_by: string;
};

const modelKey = (id: string) => id.trim().toLowerCase();

const toDraftModel = (model: AuthFileModelItem, fallbackType: string): AuthFileModelItem => ({
  id: String(model.id ?? '').trim(),
  display_name: String(model.display_name ?? '').trim() || undefined,
  type: String(model.type ?? '').trim() || fallbackType || undefined,
  owned_by: String(model.owned_by ?? '').trim() || undefined,
});

const toFormState = (model: AuthFileModelItem, fallbackType: string): ModelFormState => ({
  id: model.id,
  display_name: model.display_name ?? '',
  type: model.type ?? fallbackType,
  owned_by: model.owned_by ?? '',
});

const emptyFormState = (fallbackType: string): ModelFormState => ({
  id: '',
  display_name: '',
  type: fallbackType,
  owned_by: '',
});

const modelFingerprint = (models: AuthFileModelItem[]) =>
  JSON.stringify(
    models.map((model) => ({
      id: String(model.id ?? '').trim(),
      display_name: String(model.display_name ?? '').trim(),
      type: String(model.type ?? '').trim(),
      owned_by: String(model.owned_by ?? '').trim(),
    }))
  );

export function AuthFileModelsModal(props: AuthFileModelsModalProps) {
  const { t } = useTranslation();
  const {
    open,
    fileName,
    fileType,
    loading,
    saving,
    error,
    models,
    manual,
    excluded,
    testStatuses,
    onClose,
    onCopyText,
    onSaveModels,
    onTestModel,
  } = props;

  const fallbackType = fileType.trim();
  const [draftModels, setDraftModels] = useState<AuthFileModelItem[]>([]);
  const [editor, setEditor] = useState<ModelEditorState | null>(null);
  const [form, setForm] = useState<ModelFormState>(() => emptyFormState(fallbackType));
  const [formError, setFormError] = useState('');

  useEffect(() => {
    if (!open) return;
    setDraftModels(
      models.map((model) => toDraftModel(model, fallbackType)).filter((model) => model.id)
    );
    setEditor(null);
    setForm(emptyFormState(fallbackType));
    setFormError('');
  }, [fallbackType, models, open]);

  const sourceFingerprint = useMemo(
    () =>
      modelFingerprint(
        models.map((model) => toDraftModel(model, fallbackType)).filter((model) => model.id)
      ),
    [fallbackType, models]
  );
  const draftFingerprint = useMemo(() => modelFingerprint(draftModels), [draftModels]);
  const dirty = sourceFingerprint !== draftFingerprint;

  const startAddModel = () => {
    setEditor({ mode: 'add' });
    setForm(emptyFormState(fallbackType));
    setFormError('');
  };

  const startEditModel = (model: AuthFileModelItem) => {
    setEditor({ mode: 'edit', originalId: model.id });
    setForm(toFormState(model, fallbackType));
    setFormError('');
  };

  const cancelEditor = () => {
    setEditor(null);
    setForm(emptyFormState(fallbackType));
    setFormError('');
  };

  const submitEditor = () => {
    if (!editor) return;
    const nextModel = toDraftModel(form, fallbackType);
    if (!nextModel.id) {
      setFormError(t('auth_files.model_id_required', { defaultValue: 'Model ID is required' }));
      return;
    }

    const nextKey = modelKey(nextModel.id);
    const originalKey = editor.mode === 'edit' ? modelKey(editor.originalId ?? '') : '';
    const duplicate = draftModels.some((model) => {
      const currentKey = modelKey(model.id);
      return currentKey === nextKey && currentKey !== originalKey;
    });
    if (duplicate) {
      setFormError(t('auth_files.model_id_duplicate', { defaultValue: 'Model ID already exists' }));
      return;
    }

    setDraftModels((current) => {
      if (editor.mode === 'add') {
        return [...current, nextModel];
      }
      return current.map((model) => (modelKey(model.id) === originalKey ? nextModel : model));
    });
    cancelEditor();
  };

  const deleteModel = (modelId: string) => {
    const key = modelKey(modelId);
    setDraftModels((current) => current.filter((model) => modelKey(model.id) !== key));
    if (editor?.mode === 'edit' && modelKey(editor.originalId ?? '') === key) {
      cancelEditor();
    }
  };

  const saveDraft = async () => {
    if (!dirty || saving || editor) return;
    try {
      await onSaveModels(draftModels);
    } catch {
      // The hook owns user-facing save errors.
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('auth_files.models_title', { defaultValue: '支持的模型' }) + ` - ${fileName}`}
      width={760}
      closeDisabled={saving}
      footer={
        <Button variant="secondary" onClick={onClose} disabled={saving}>
          {t('common.close')}
        </Button>
      }
    >
      {loading ? (
        <div className={styles.hint}>
          {t('auth_files.models_loading', { defaultValue: '正在加载模型列表...' })}
        </div>
      ) : error === 'unsupported' ? (
        <EmptyState
          title={t('auth_files.models_unsupported', { defaultValue: '当前版本不支持此功能' })}
          description={t('auth_files.models_unsupported_desc', {
            defaultValue: '请更新 CLI Proxy API 到最新版本后重试',
          })}
        />
      ) : draftModels.length === 0 ? (
        <>
          <div className={styles.modelsToolbar}>
            <div className={styles.modelsToolbarMeta}>
              <span className={styles.modelsModeBadge}>
                {manual
                  ? t('auth_files.models_manual_badge', { defaultValue: 'Manual' })
                  : t('auth_files.models_auto_badge', { defaultValue: 'Auto' })}
              </span>
              <span>
                {t('auth_files.models_count', {
                  defaultValue: '{{count}} models',
                  count: draftModels.length,
                })}
              </span>
            </div>
            <div className={styles.modelsToolbarActions}>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={startAddModel}
                disabled={saving}
              >
                <IconPlus size={14} />
                {t('auth_files.model_add', { defaultValue: 'Add model' })}
              </Button>
              <Button
                type="button"
                size="sm"
                loading={saving}
                disabled={!dirty || Boolean(editor) || saving}
                onClick={() => void saveDraft()}
              >
                {t('common.save', { defaultValue: 'Save' })}
              </Button>
            </div>
          </div>
          {editor && (
            <div className={styles.modelEditorPanel}>
              <div className={styles.modelEditorGrid}>
                <input
                  className={styles.modelEditInput}
                  value={form.id}
                  placeholder={t('auth_files.model_id_placeholder', { defaultValue: 'Model ID' })}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, id: event.target.value }))
                  }
                />
                <input
                  className={styles.modelEditInput}
                  value={form.display_name}
                  placeholder={t('auth_files.model_display_name_placeholder', {
                    defaultValue: 'Display name',
                  })}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, display_name: event.target.value }))
                  }
                />
                <input
                  className={styles.modelEditInput}
                  value={form.type}
                  placeholder={t('auth_files.model_type_placeholder', { defaultValue: 'Type' })}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, type: event.target.value }))
                  }
                />
                <input
                  className={styles.modelEditInput}
                  value={form.owned_by}
                  placeholder={t('auth_files.model_owned_by_placeholder', {
                    defaultValue: 'Owned by',
                  })}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, owned_by: event.target.value }))
                  }
                />
              </div>
              <div className={styles.modelEditorActions}>
                <Button type="button" size="sm" onClick={submitEditor}>
                  <IconCheck size={14} />
                  {t('common.apply', { defaultValue: 'Apply' })}
                </Button>
                <Button type="button" size="sm" variant="secondary" onClick={cancelEditor}>
                  <IconX size={14} />
                  {t('common.cancel', { defaultValue: 'Cancel' })}
                </Button>
              </div>
              {formError && <div className={styles.modelEditorError}>{formError}</div>}
            </div>
          )}
          <EmptyState
            title={t('auth_files.models_empty', { defaultValue: '该凭证暂无可用模型' })}
            description={t('auth_files.models_empty_desc', {
              defaultValue: '该认证凭证可能尚未被服务器加载或没有绑定任何模型',
            })}
          />
        </>
      ) : (
        <>
          <div className={styles.modelsToolbar}>
            <div className={styles.modelsToolbarMeta}>
              <span className={styles.modelsModeBadge}>
                {manual
                  ? t('auth_files.models_manual_badge', { defaultValue: 'Manual' })
                  : t('auth_files.models_auto_badge', { defaultValue: 'Auto' })}
              </span>
              <span>
                {t('auth_files.models_count', {
                  defaultValue: '{{count}} models',
                  count: draftModels.length,
                })}
              </span>
            </div>
            <div className={styles.modelsToolbarActions}>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={startAddModel}
                disabled={saving}
              >
                <IconPlus size={14} />
                {t('auth_files.model_add', { defaultValue: 'Add model' })}
              </Button>
              <Button
                type="button"
                size="sm"
                loading={saving}
                disabled={!dirty || Boolean(editor) || saving}
                onClick={() => void saveDraft()}
              >
                {t('common.save', { defaultValue: 'Save' })}
              </Button>
            </div>
          </div>
          {editor && (
            <div className={styles.modelEditorPanel}>
              <div className={styles.modelEditorGrid}>
                <input
                  className={styles.modelEditInput}
                  value={form.id}
                  placeholder={t('auth_files.model_id_placeholder', { defaultValue: 'Model ID' })}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, id: event.target.value }))
                  }
                />
                <input
                  className={styles.modelEditInput}
                  value={form.display_name}
                  placeholder={t('auth_files.model_display_name_placeholder', {
                    defaultValue: 'Display name',
                  })}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, display_name: event.target.value }))
                  }
                />
                <input
                  className={styles.modelEditInput}
                  value={form.type}
                  placeholder={t('auth_files.model_type_placeholder', { defaultValue: 'Type' })}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, type: event.target.value }))
                  }
                />
                <input
                  className={styles.modelEditInput}
                  value={form.owned_by}
                  placeholder={t('auth_files.model_owned_by_placeholder', {
                    defaultValue: 'Owned by',
                  })}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, owned_by: event.target.value }))
                  }
                />
              </div>
              <div className={styles.modelEditorActions}>
                <Button type="button" size="sm" onClick={submitEditor}>
                  <IconCheck size={14} />
                  {t('common.apply', { defaultValue: 'Apply' })}
                </Button>
                <Button type="button" size="sm" variant="secondary" onClick={cancelEditor}>
                  <IconX size={14} />
                  {t('common.cancel', { defaultValue: 'Cancel' })}
                </Button>
              </div>
              {formError && <div className={styles.modelEditorError}>{formError}</div>}
            </div>
          )}
          <div className={styles.modelsList}>
            {draftModels.map((model) => {
              const excludedModel = isModelExcluded(model.id, fileType, excluded);
              const testState = testStatuses[model.id]?.status ?? 'idle';
              const testMessage = testStatuses[model.id]?.message;
              const testButtonLabel =
                testState === 'loading'
                  ? t('auth_files.model_test_running', { defaultValue: 'Testing...' })
                  : testState === 'success'
                    ? t('auth_files.model_test_success', { defaultValue: 'Test passed' })
                    : testState === 'error'
                      ? t('auth_files.model_test_failed_short', { defaultValue: 'Failed' })
                      : t('auth_files.model_test', { defaultValue: 'Test' });
              return (
                <div
                  key={model.id}
                  className={`${styles.modelItem} ${excludedModel ? styles.modelItemExcluded : ''}`}
                  onClick={() => {
                    onCopyText(model.id);
                  }}
                  title={
                    excludedModel
                      ? t('auth_files.models_excluded_hint', {
                          defaultValue: '此 OAuth 模型已被禁用',
                        })
                      : t('common.copy', { defaultValue: '点击复制' })
                  }
                >
                  <span className={styles.modelMain}>
                    <span className={styles.modelId}>{model.id}</span>
                    {model.display_name && model.display_name !== model.id && (
                      <span className={styles.modelDisplayName}>{model.display_name}</span>
                    )}
                  </span>
                  <span className={styles.modelActions}>
                    {model.type && <span className={styles.modelType}>{model.type}</span>}
                    {excludedModel && (
                      <span className={styles.modelExcludedBadge}>
                        {t('auth_files.models_excluded_badge', { defaultValue: '已禁用' })}
                      </span>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      className={styles.modelInlineButton}
                      onClick={(event) => {
                        event.stopPropagation();
                        startEditModel(model);
                      }}
                    >
                      {t('common.edit', { defaultValue: 'Edit' })}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="danger"
                      className={styles.modelIconButton}
                      title={t('common.delete', { defaultValue: 'Delete' })}
                      aria-label={`${t('common.delete', { defaultValue: 'Delete' })} ${model.id}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        deleteModel(model.id);
                      }}
                    >
                      <IconTrash2 size={14} />
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={testState === 'error' ? 'danger' : 'secondary'}
                      loading={testState === 'loading'}
                      className={`${styles.modelTestButton} ${
                        testState === 'success'
                          ? styles.modelTestButtonSuccess
                          : testState === 'error'
                            ? styles.modelTestButtonError
                            : ''
                      }`}
                      title={
                        testMessage ||
                        t('auth_files.model_test_hint', {
                          defaultValue: 'Send a small request with this auth file and model',
                        })
                      }
                      aria-label={`${t('auth_files.model_test', { defaultValue: 'Test' })} ${model.id}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onTestModel(model.id);
                      }}
                    >
                      {testButtonLabel}
                    </Button>
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </Modal>
  );
}
