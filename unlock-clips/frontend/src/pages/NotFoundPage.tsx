import { Compass } from "lucide-react";
import { Link } from "react-router-dom";
import EmptyState from "../components/EmptyState";

export default function NotFoundPage() {
  return (
    <EmptyState
      icon={Compass}
      title="Página não encontrada"
      action={
        <Link to="/" className="btn btn-primary">
          Voltar ao painel
        </Link>
      }
    >
      O endereço acessado não existe.
    </EmptyState>
  );
}
