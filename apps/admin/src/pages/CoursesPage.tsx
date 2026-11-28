import { BookOpen, RefreshCw } from "lucide-react";
import { useI18n } from "@codequest/i18n";
import { api } from "../api";
import { useAsyncData } from "../hooks/useAsyncData";
import { Button, EmptyState, ErrorState, LoadingState, PageHeader } from "../components/ui";

export function CoursesPage() {
  const { t } = useI18n();
  const courses = useAsyncData(() => api.courses(), []);

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow={t("courses.eyebrow")}
        title={t("admin.nav.courses")}
        description={t("courses.description")}
        actions={<Button variant="outline" size="small" onClick={courses.reload} disabled={courses.loading}><RefreshCw size={15} />{t("courses.refresh")}</Button>}
      />

      <section className="panel" aria-labelledby="course-list-title">
        <div className="panel-heading">
          <div><p className="eyebrow">{t("courses.listEyebrow")}</p><h2 id="course-list-title">{t("courses.listTitle")}</h2><p>{t("courses.listDescription")}</p></div>
        </div>
        {courses.loading ? <LoadingState label={t("courses.loading")} /> : courses.error ? <ErrorState error={courses.error} onRetry={courses.reload} /> : (
          <EmptyState
            title={t("courses.emptyTitle")}
            description={t("courses.emptyDescription")}
          />
        )}
      </section>

      <div className="publishing-note"><span><BookOpen size={17} /></span><p>{t("courses.publishingNote")}</p></div>
    </div>
  );
}
