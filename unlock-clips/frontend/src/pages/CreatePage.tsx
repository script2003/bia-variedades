import NewProjectPanel from "../components/NewProjectPanel";
import PageHeader from "../components/PageHeader";

export default function CreatePage() {
  return (
    <>
      <PageHeader
        title="Criar cortes"
        description="Escolha o vídeo de origem e ajuste como os cortes devem ser gerados. As configurações ficam salvas no projeto e podem ser alteradas depois."
      />
      <NewProjectPanel showSettings />
    </>
  );
}
