import { BookOpen, RefreshCw } from "lucide-react";
import { api } from "../api";
import { useAsyncData } from "../hooks/useAsyncData";
import { Button, EmptyState, ErrorState, LoadingState, PageHeader } from "../components/ui";

export function CoursesPage() {
  const courses = useAsyncData(() => api.courses(), []);

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="COURSE LIBRARY"
        title="课程管理"
        description="课程接口已抽象为通用契约，当前版本固定返回无课程。"
        actions={<Button variant="outline" size="small" onClick={courses.reload} disabled={courses.loading}><RefreshCw size={15} />刷新</Button>}
      />

      <section className="panel" aria-labelledby="course-list-title">
        <div className="panel-heading">
          <div><p className="eyebrow">COURSE PROVIDER</p><h2 id="course-list-title">课程列表</h2><p>当前使用空课程实现：目录为空，详情与内容固定返回 404。</p></div>
        </div>
        {courses.loading ? <LoadingState label="正在加载课程列表" /> : courses.error ? <ErrorState error={courses.error} onRetry={courses.reload} /> : (
          <EmptyState
            title="当前版本暂不提供课程"
            description="课程目录与内容接口固定返回空结果，待后续版本接入具体课程实现。"
          />
        )}
      </section>

      <div className="publishing-note"><span><BookOpen size={17} /></span><p>本版本不提供课程包上传与上下架，避免学员端出现与空目录不一致的状态。</p></div>
    </div>
  );
}
