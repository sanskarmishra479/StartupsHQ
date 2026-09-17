import {
  categoryMetadata,
  categoryPage,
  categoryStaticParams,
} from "../../_lib/category-route";

// FR-108: /categories/stages/[slug].

export const generateStaticParams = categoryStaticParams("stages");
export const generateMetadata = categoryMetadata("stages");
export default categoryPage("stages");
