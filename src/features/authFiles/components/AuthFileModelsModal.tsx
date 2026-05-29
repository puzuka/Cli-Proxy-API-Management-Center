import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import type { AuthFileModelItem } from '@/features/authFiles/constants';
import { isModelExcluded } from '@/features/authFiles/constants';
import type { ModelTestState } from '@/features/authFiles/hooks/useAuthFilesModels';
import styles from '@/pages/AuthFilesPage.module.scss';

export type AuthFileModelsModalProps = {
  open: boolean;
  fileName: string;
  fileType: string;
  loading: boolean;
  error: 'unsupported' | null;
  models: AuthFileModelItem[];
  excluded: Record<string, string[]>;
  testStatuses: Record<string, ModelTestState>;
  onClose: () => void;
  onCopyText: (text: string) => void;
  onTestModel: (modelId: string) => void;
};

export function AuthFileModelsModal(props: AuthFileModelsModalProps) {
  const { t } = useTranslation();
  const {
    open,
    fileName,
    fileType,
    loading,
    error,
    models,
    excluded,
    testStatuses,
    onClose,
    onCopyText,
    onTestModel
  } = props;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('auth_files.models_title', { defaultValue: '支持的模型' }) + ` - ${fileName}`}
      footer={
        <Button variant="secondary" onClick={onClose}>
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
            defaultValue: '请更新 CLI Proxy API 到最新版本后重试'
          })}
        />
      ) : models.length === 0 ? (
        <EmptyState
          title={t('auth_files.models_empty', { defaultValue: '该凭证暂无可用模型' })}
          description={t('auth_files.models_empty_desc', {
            defaultValue: '该认证凭证可能尚未被服务器加载或没有绑定任何模型'
          })}
        />
      ) : (
        <div className={styles.modelsList}>
          {models.map((model) => {
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
                        defaultValue: '此 OAuth 模型已被禁用'
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
                        defaultValue: 'Send a small request with this auth file and model'
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
      )}
    </Modal>
  );
}
